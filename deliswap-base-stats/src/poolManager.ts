import { Address, BigDecimal, BigInt, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import {
    Initialize,
    ModifyLiquidity,
    Swap
} from "../generated/PoolManager/PoolManager"
// Import PositionManager ABI to call ownerOf
import { PositionManager } from "../generated/PoolManager/PositionManager"
import { Pool, Action, Position, User } from "../generated/schema"
import { DELI_HOOK_V2_ADDRESS, DELI_HOOK_V4_ADDRESS, V4_POSITION_MANAGER_ADDRESS, ZERO_BI } from "./constants"
import { loadOrCreateToken, loadOrCreateUser, createTVLSnapshot } from "./helpers"

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
    // Removed USD TVL

    // Initialize price/tick fields (included in the event signature for both V2/V4)
    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = event.params.tick

    pool.save()
    createTVLSnapshot(pool, event)
}


export function handleModifyLiquidity(event: ModifyLiquidity): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        // This happens if the pool initialization was filtered out (not a DeliSwap hook)
        return
    }

    // V2 handles liquidity modifications via the V2 Hook (Mint/Burn/Sync events).
    if (pool.type == "V2") {
        return
    }

    // --- V4 Liquidity Modification ---
    // This handler is crucial for tracking V4 positions and actions, as it provides the PoolId.

    let liquidityDelta = event.params.liquidityDelta
    let senderAddress = event.params.sender
    let tickLower = event.params.tickLower
    let tickUpper = event.params.tickUpper

    // Determine the user who owns the position and update the Position entity.
    let user: User

    // Check if the sender is the V4 PositionManager (indicating an NFT position change).
    if (senderAddress.equals(V4_POSITION_MANAGER_ADDRESS)) {
        // If sent by PositionManager, the salt is the tokenId.
        let tokenId = event.params.salt.toBigInt()
        let positionId = tokenId.toString()

        // We need to find the owner of the NFT to attribute the action and position correctly.
        let pmContract = PositionManager.bind(V4_POSITION_MANAGER_ADDRESS)
        // We use try_ownerOf because the contract call might revert if the NFT was just burned (liquidity removed completely).
        let ownerResult = pmContract.try_ownerOf(tokenId)

        let existingPosition = Position.load(positionId)

        if (ownerResult.reverted) {
            // This happens if the NFT was burned in the same transaction (liquidity reduced to 0).
            if (existingPosition != null && liquidityDelta.lt(ZERO_BI)) {
                // If burning and owner lookup fails, use the last known owner stored in the entity.
                user = loadOrCreateUser(Address.fromString(existingPosition.user))
            } else {
                // If MINTing or increasing liquidity, the owner must exist. If not found, it's an error state.
                log.error("Could not determine owner of V4 Position NFT: {} (Reverted). TxHash: {}", [positionId, event.transaction.hash.toHexString()])
                // Fallback to the sender (PositionManager address) if owner cannot be determined, though this is functionally incorrect for user tracking.
                user = loadOrCreateUser(senderAddress)
            }
        } else {
            user = loadOrCreateUser(ownerResult.value)
        }

        // Update or Create the Position entity
        let position = existingPosition
        if (position == null) {
            // New position being created (MINT).
            position = new Position(positionId)
            position.pool = pool.id
            position.tokenId = tokenId
            position.tickLower = tickLower
            position.tickUpper = tickUpper
            position.liquidity = ZERO_BI
            position.reserve0 = ZERO_BI
            position.reserve1 = ZERO_BI
        }
        // Update the owner (important if the NFT was just minted or transferred in the same block)
        position.user = user.id
        position.liquidity = position.liquidity.plus(liquidityDelta)

        // TODO: Update V4 position reserves (User TVL: reserve0/reserve1).
        // This requires complex calculations based on the current price, ticks, and liquidity.
        // V4 User TVL tracking is deferred due to complexity.

        position.save()

    } else {
        // Liquidity modified directly via PoolManager (not through PositionManager NFT).
        user = loadOrCreateUser(senderAddress)

        // TODO: Implement tracking for non-NFT V4 positions if required. This requires tracking positions based on sender + salt.
        log.warning("Direct PoolManager liquidity modification detected. Non-NFT Position tracking not implemented. Pool: {}, Sender: {}, Salt: {}", [poolId, senderAddress.toHexString(), event.params.salt.toHexString()])
    }


    // Record the action (Mint or Burn).
    let actionType = liquidityDelta.gt(ZERO_BI) ? "MINT" : "BURN"
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()

    let action = new Action(actionId)
    action.type = actionType
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = user.id // The owner of the position (or the direct sender)

    // LIMITATION: PoolManager.ModifyLiquidity does not emit amount0/amount1.
    // We cannot fulfill the requirement to track the exact amounts for V4 actions without decoding transaction input.
    // TODO: Investigate decoding transaction input from PositionManager calls if exact V4 amounts are critical.
    action.amount0 = ZERO_BI // Placeholder
    action.amount1 = ZERO_BI // Placeholder

    action.save()

    // Update V4 TVL and Snapshot
    // Note: We update the snapshot here, but pool.reserve0/1 (Pool TVL) are NOT updated in this handler
    // because we don't know the amounts (amount0/1). V4 Pool TVL tracking via ModifyLiquidity is incomplete.
    // V4 Pool TVL is currently only updated via Swap events.
    pool.save()
    createTVLSnapshot(pool, event)
}

export function handleSwap(event: Swap): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    // The sender of the swap event is the user who initiated the swap (the trader).
    let sender = loadOrCreateUser(event.params.sender)

    // amount0 and amount1 are the deltas for the pool reserves
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    // Determine direction and amounts In/Out
    let amount0In = amount0.gt(ZERO_BI) ? amount0 : ZERO_BI
    let amount1In = amount1.gt(ZERO_BI) ? amount1 : ZERO_BI
    let amount0Out = amount0.lt(ZERO_BI) ? amount0.abs() : ZERO_BI
    let amount1Out = amount1.lt(ZERO_BI) ? amount1.abs() : ZERO_BI

    let tokenInId = amount0In.gt(ZERO_BI) ? pool.token0 : pool.token1
    let tokenOutId = amount0Out.gt(ZERO_BI) ? pool.token0 : pool.token1
    let amountIn = amount0In.gt(ZERO_BI) ? amount0In : amount1In
    let amountOut = amount0Out.gt(ZERO_BI) ? amount0Out : amount1Out

    // Removed USD calculation

    // Record the Action
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "SWAP"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // For Swaps, we store the deltas (one positive, one negative)
    action.amount0 = amount0
    action.amount1 = amount1

    action.tokenIn = tokenInId
    action.tokenOut = tokenOutId
    action.amountIn = amountIn
    action.amountOut = amountOut

    // Buy/Sell indicators (fulfills requirement to query swap direction for a token)
    // isBuyToken0 = User receives token0 (amount0Out > 0)
    action.isBuyToken0 = amount0Out.gt(ZERO_BI)
    // isBuyToken1 = User receives token1 (amount1Out > 0)
    action.isBuyToken1 = amount1Out.gt(ZERO_BI)

    action.save()

    // Update Pool State
    // Update price/tick for both V2 and V4
    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = event.params.tick

    if (pool.type == "V4") {
        // Update V4 active liquidity
        pool.liquidity = event.params.liquidity

        // Update V4 reserves (Pool TVL Tracking for V4)
        // V4 reserves represent the total locked tokens. We update them by the swap deltas.
        pool.reserve0 = pool.reserve0.plus(amount0)
        pool.reserve1 = pool.reserve1.plus(amount1)

        pool.save()
        createTVLSnapshot(pool, event)
    }

    // For V2, the Sync event handles the reserve/TVL updates and snapshot.
    if (pool.type == "V2") {
        pool.save()
    }
}
