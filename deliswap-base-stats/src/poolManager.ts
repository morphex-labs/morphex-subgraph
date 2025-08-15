import { Address, BigDecimal, BigInt, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import {
    Initialize,
    ModifyLiquidity,
    Swap
} from "../generated/PoolManager/PoolManager"
import { Pool, Action, TVLSnapshot } from "../generated/schema"
import { DELI_HOOK_V2_ADDRESS, DELI_HOOK_V4_ADDRESS, ZERO_BI, ZERO_BD } from "./constants"
import { loadOrCreateToken, loadOrCreateUser, calculateAmountUSD } from "./helpers"

// Helper to check if the hook address is a DeliSwap hook
function isDeliSwapHook(hookAddress: Address): boolean {
    return hookAddress.equals(DELI_HOOK_V2_ADDRESS) || hookAddress.equals(DELI_HOOK_V4_ADDRESS)
}

function getPoolType(hookAddress: Address): string {
    if (hookAddress.equals(DELI_HOOK_V2_ADDRESS)) {
        return "V2"
    }
    if (hookAddress.equals(DELI_HOOK_V4_ADDRESS)) {
        return "V4"
    }
    return "UNKNOWN"
}

export function handleInitialize(event: Initialize): void {
    let hookAddress = event.params.hooks

    // Filter: Only track DeliSwap pools
    if (!isDeliSwapHook(hookAddress)) {
        return
    }

    let poolId = event.params.id.toHexString()
    log.info("Tracking new DeliSwap Pool. ID: {}, Hook: {}", [poolId, hookAddress.toHexString()])

    let token0 = loadOrCreateToken(event.params.currency0)
    let token1 = loadOrCreateToken(event.params.currency1)

    let pool = new Pool(poolId)
    pool.type = getPoolType(hookAddress)
    pool.hookAddress = hookAddress
    pool.token0 = token0.id
    pool.token1 = token1.id
    pool.fee = event.params.fee
    pool.tickSpacing = event.params.tickSpacing

    pool.createdAtTimestamp = event.block.timestamp
    pool.createdAtBlockNumber = event.block.number

    // Initialize liquidity and reserves
    pool.liquidity = ZERO_BI
    pool.reserve0 = ZERO_BI
    pool.reserve1 = ZERO_BI
    pool.totalValueLockedUSD = ZERO_BD

    // V4 specific fields
    if (pool.type == "V4") {
        pool.sqrtPrice = event.params.sqrtPriceX96
        pool.tick = event.params.tick
    }

    pool.save()
}

// TODO: Implement V4 TVL tracking logic.
function updatePoolTVL_V4(pool: Pool, event: ethereum.Event): void {
    // V4 TVL requires tracking the total balance of token0 and token1 locked.
    // This involves aggregating net deltas from ModifyLiquidity and Swap events.
    // Implementation deferred due to complexity.
}


export function handleModifyLiquidity(event: ModifyLiquidity): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    // V2 handles liquidity modifications via the V2 Hook (Mint/Burn events).
    if (pool.type == "V2") {
        return
    }

    // --- V4 Liquidity Modification ---
    let liquidityDelta = event.params.liquidityDelta
    let sender = loadOrCreateUser(event.params.sender)

    // TODO: Update V4 pool state (reserve0, reserve1).

    // Record the action (Mint or Burn).
    let actionType = liquidityDelta.gt(ZERO_BI) ? "MINT" : "BURN"
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()

    let action = new Action(actionId)
    action.type = actionType
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // LIMITATION: PoolManager.ModifyLiquidity does not emit amount0/amount1.
    // To get these amounts (required for V4 TVL and Action details), the PositionManager datasource must be indexed.
    action.amount0 = ZERO_BI // Placeholder
    action.amount1 = ZERO_BI // Placeholder
    action.amountUSD = ZERO_BD // Placeholder

    action.save()

    // Update V4 TVL and Snapshot
    // updatePoolTVL_V4(pool, event)
}

export function handleSwap(event: Swap): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    let sender = loadOrCreateUser(event.params.sender)
    let token0 = loadOrCreateToken(Address.fromString(pool.token0))
    let token1 = loadOrCreateToken(Address.fromString(pool.token1))

    // amount0 and amount1 are the deltas for the pool reserves
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    // Determine direction and amounts In/Out
    let amount0In = amount0.gt(ZERO_BI) ? amount0 : ZERO_BI
    let amount1In = amount1.gt(ZERO_BI) ? amount1 : ZERO_BI
    let amount0Out = amount0.lt(ZERO_BI) ? amount0.abs() : ZERO_BI
    let amount1Out = amount1.lt(ZERO_BI) ? amount1.abs() : ZERO_BI

    let tokenIn = amount0In.gt(ZERO_BI) ? token0.id : token1.id
    let tokenOut = amount0Out.gt(ZERO_BI) ? token0.id : token1.id
    let amountIn = amount0In.gt(ZERO_BI) ? amount0In : amount1In
    let amountOut = amount0Out.gt(ZERO_BI) ? amount0Out : amount1Out

    // Calculate USD value
    // TODO: Improve USD calculation once pricing is implemented.
    let amountUSD = calculateAmountUSD(token0, amount0.abs(), token1, amount1.abs())

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "SWAP"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    action.amount0 = amount0
    action.amount1 = amount1
    action.amountUSD = amountUSD

    action.tokenIn = tokenIn
    action.tokenOut = tokenOut
    action.amountIn = amountIn
    action.amountOut = amountOut

    // Buy/Sell indicators (fulfills requirement to query swap direction for a token)
    // isBuyToken0 = User receives token0 (amount0Out > 0)
    action.isBuyToken0 = amount0Out.gt(ZERO_BI)
    // isBuyToken1 = User receives token1 (amount1Out > 0)
    action.isBuyToken1 = amount1Out.gt(ZERO_BI)

    action.save()

    // Update Pool State
    if (pool.type == "V4") {
        // Update V4 specific fields
        pool.sqrtPrice = event.params.sqrtPriceX96
        pool.tick = event.params.tick
        pool.liquidity = event.params.liquidity

        // TODO: Update V4 reserves (total locked)
        // pool.reserve0 = pool.reserve0.plus(amount0)
        // pool.reserve1 = pool.reserve1.plus(amount1)

        // Update V4 TVL and Snapshot
        // updatePoolTVL_V4(pool, event)
    }

    // For V2, the Sync event handles the reserve/TVL updates.
    pool.save()
}
