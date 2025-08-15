import { Sync, Mint, Burn } from "../generated/DeliHookConstantProduct/DeliHookConstantProduct"
import { Pool, TVLSnapshot, Action, Position } from "../generated/schema"
import { ZERO_BD, ZERO_BI } from "./constants"
import { loadOrCreateUser, calculateAmountUSD, loadOrCreateToken } from "./helpers"
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"

// Function to update TVL and create snapshot (specific for V2 Sync)
function updatePoolTVL_V2(pool: Pool, reserve0: BigInt, reserve1: BigInt, event: ethereum.Event): void {
    // Update reserves from the Sync event
    pool.reserve0 = reserve0
    pool.reserve1 = reserve1

    let token0 = loadOrCreateToken(Address.fromString(pool.token0))
    let token1 = loadOrCreateToken(Address.fromString(pool.token1))

    // Recalculate TVL
    // TODO: This will be accurate once pricing logic is implemented in helpers.ts
    pool.totalValueLockedUSD = calculateAmountUSD(token0, pool.reserve0, token1, pool.reserve1)
    pool.save()

    // Create historical snapshot
    let snapshotId = pool.id + "-" + event.block.timestamp.toString()
    let snapshot = TVLSnapshot.load(snapshotId)
    // Avoid duplicate snapshots in the same timestamp (e.g., multiple events in one block)
    if (snapshot == null) {
        snapshot = new TVLSnapshot(snapshotId)
        snapshot.pool = pool.id
        snapshot.timestamp = event.block.timestamp
        snapshot.blockNumber = event.block.number
        // Pool.liquidity (Total LP Supply for V2) is updated via V2PositionHandler events
        snapshot.liquidity = pool.liquidity
        snapshot.reserve0 = pool.reserve0
        snapshot.reserve1 = pool.reserve1
        snapshot.totalValueLockedUSD = pool.totalValueLockedUSD
        snapshot.save()
    }

    // Crucial Step: Update all user positions' underlying reserves based on the new pool reserves.
    // This ensures User TVL remains accurate after the pool state changes (e.g., after a swap).
    let positions = pool.positions.load()
    for (let i = 0; i < positions.length; i++) {
        updateV2PositionReserves(positions[i], pool)
    }
}

// Helper defined here and exported for use in v2positionHandler.ts
// This ensures that User TVL is updated whenever Pool TVL or User Liquidity changes.
export function updateV2PositionReserves(position: Position, pool: Pool): void {
    // Pool.liquidity represents Total LP Supply for V2.
    if (pool.liquidity.gt(ZERO_BI) && position.liquidity.gt(ZERO_BI)) {
        // reserve = total_reserve * (position_liquidity / total_liquidity)
        position.reserve0 = pool.reserve0.times(position.liquidity).div(pool.liquidity)
        position.reserve1 = pool.reserve1.times(position.liquidity).div(pool.liquidity)
    } else {
        position.reserve0 = ZERO_BI
        position.reserve1 = ZERO_BI
    }
    // TODO: Calculate USD value once pricing is implemented.
    position.valueUSD = ZERO_BD
    position.save()
}


// Handle Sync event: Updates V2 reserves and TVL after any action (Swap, Mint, Burn)
export function handleSync(event: Sync): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    updatePoolTVL_V2(pool, event.params.reserve0, event.params.reserve1, event)
}

// Handle Mint event: Records the V2 MINT action details (amounts)
export function handleV2Mint(event: Mint): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    let token0 = loadOrCreateToken(Address.fromString(pool.token0))
    let token1 = loadOrCreateToken(Address.fromString(pool.token1))
    // TODO: Accurate USD calculation requires pricing implementation
    let amountUSD = calculateAmountUSD(token0, amount0, token1, amount1)

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "MINT"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // MINT adds liquidity
    action.amount0 = amount0
    action.amount1 = amount1
    action.amountUSD = amountUSD

    action.save()
}

// Handle Burn event: Records the V2 BURN action details (amounts)
export function handleV2Burn(event: Burn): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    // The 'sender' initiated the burn.
    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    let token0 = loadOrCreateToken(Address.fromString(pool.token0))
    let token1 = loadOrCreateToken(Address.fromString(pool.token1))
    // TODO: Accurate USD calculation requires pricing implementation
    let amountUSD = calculateAmountUSD(token0, amount0, token1, amount1)

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "BURN"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // BURN removes liquidity
    action.amount0 = amount0
    action.amount1 = amount1
    action.amountUSD = amountUSD

    action.save()
}