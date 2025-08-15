import { Sync, Mint, Burn } from "../generated/DeliHookConstantProduct/DeliHookConstantProduct"
import { Pool, Action, Position } from "../generated/schema"
import { ZERO_BI } from "./constants"
import { loadOrCreateUser, createTVLSnapshot } from "./helpers"
import { BigInt, ethereum } from "@graphprotocol/graph-ts"

// Function to update TVL (specific for V2 Sync)
function updatePoolTVL_V2(pool: Pool, reserve0: BigInt, reserve1: BigInt, event: ethereum.Event): void {
    // Update reserves from the Sync event
    pool.reserve0 = reserve0
    pool.reserve1 = reserve1

    // Removed USD TVL calculation
    pool.save()

    // Create historical snapshot
    createTVLSnapshot(pool, event)

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
    // Removed USD value calculation
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

    // The 'sender' initiated the mint.
    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    // Removed USD calculation

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "MINT"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // MINT adds liquidity (store positive magnitude)
    action.amount0 = amount0
    action.amount1 = amount1

    action.save()
}

// Handle Burn event: Records the V2 BURN action details (amounts)
export function handleV2Burn(event: Burn): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    // The 'sender' initiated the burn. We associate the action with the sender.
    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    // Removed USD calculation

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "BURN"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // BURN removes liquidity (store positive magnitude of tokens removed)
    action.amount0 = amount0
    action.amount1 = amount1

    action.save()
}
