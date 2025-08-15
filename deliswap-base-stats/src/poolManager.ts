import { Address, BigDecimal, BigInt, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import {
    PoolManager,
    Initialize,
    ModifyLiquidity,
    Swap
} from "../generated/PoolManager/PoolManager"
import { PositionManager } from "../generated/PoolManager/PositionManager"
import { Pool, Action, Position, User } from "../generated/schema"
import { DELI_HOOK_V2_ADDRESS, DELI_HOOK_V4_ADDRESS, V4_POSITION_MANAGER_ADDRESS, ZERO_BI } from "./constants"
import { loadOrCreateToken, loadOrCreateUser, createTVLSnapshot } from "./helpers"
import { getSqrtRatioAtTick, getAmount0ForLiquidity, getAmount1ForLiquidity } from "./utils/v4math"

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

// Helper function to calculate and update V4 position reserves (User TVL)
function updateV4PositionReserves(position: Position, pool: Pool): void {
    // **FIX:** Simplified null checks to avoid compiler assertion failure.
    // Safeguards, although V4 pools should always have price/ticks if initialized.
    if (pool.sqrtPrice == null) return
    if (pool.tick == null) return
    if (position.tickLower == null) return
    if (position.tickUpper == null) return

    // If liquidity is zero (or negative due to BigInt representation), reserves must be zero.
    if (position.liquidity.le(ZERO_BI)) {
        position.liquidity = ZERO_BI
        position.reserve0 = ZERO_BI
        position.reserve1 = ZERO_BI
        position.save()
        return
    }

    let sqrtPriceX96 = pool.sqrtPrice!
    let tickCurrent = pool.tick!
    let tickLower = position.tickLower!
    let tickUpper = position.tickUpper!
    let liquidity = position.liquidity

    // Calculate sqrtPrice at ticks.
    let sqrtRatioAX96 = getSqrtRatioAtTick(tickLower)
    let sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper)

    // Check for errors during sqrtRatio calculation (e.g., invalid ticks)
    if (sqrtRatioAX96.equals(ZERO_BI) || sqrtRatioBX96.equals(ZERO_BI)) {
        log.warning("Could not calculate sqrtRatio at ticks for position {}. Ticks: {}, {}", [position.id, tickLower.toString(), tickUpper.toString()])
        return
    }


    let amount0 = ZERO_BI
    let amount1 = ZERO_BI

    // Calculate reserves based on current price relative to the range.
    // Based on Uniswap V3/V4 logic (LiquidityAmounts.sol)
    if (tickCurrent < tickLower) {
        // Price is below the range, position is fully in token0
        amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    } else if (tickCurrent < tickUpper) {
        // Price is within the range, position is in both tokens
        // amount0 from current price to upper tick
        amount0 = getAmount0ForLiquidity(sqrtPriceX96, sqrtRatioBX96, liquidity)
        // amount1 from lower tick to current price
        amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtPriceX96, liquidity)
    } else {
        // Price is above the range (tickCurrent >= tickUpper), position is fully in token1
        amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    }

    position.reserve0 = amount0
    position.reserve1 = amount1
    position.save()
}

// Helper function to calculate V4 action amounts (MINT/BURN)
function calculateV4ActionAmounts(pool: Pool, tickLower: i32, tickUpper: i32, liquidityDelta: BigInt): BigInt[] {
    if (pool.sqrtPrice == null || pool.tick == null) {
        // Should have been fetched/validated before calling this.
        return [ZERO_BI, ZERO_BI]
    }

    let sqrtPriceX96 = pool.sqrtPrice!
    let tickCurrent = pool.tick!
    let liquidity = liquidityDelta.abs()

    let sqrtRatioAX96 = getSqrtRatioAtTick(tickLower)
    let sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper)

    if (sqrtRatioAX96.equals(ZERO_BI) || sqrtRatioBX96.equals(ZERO_BI)) {
        log.warning("Could not calculate sqrtRatio at ticks for pool {}. Ticks: {}, {}", [pool.id, tickLower.toString(), tickUpper.toString()])
        return [ZERO_BI, ZERO_BI]
    }

    let amount0 = ZERO_BI
    let amount1 = ZERO_BI

    // The calculation logic is identical to the reserve calculation.
    if (tickCurrent < tickLower) {
        amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    } else if (tickCurrent < tickUpper) {
        // Note: For MINT (liquidityDelta > 0), we use the formulas directly.
        // For BURN (liquidityDelta < 0), the formulas still correctly calculate the magnitude of tokens withdrawn.
        amount0 = getAmount0ForLiquidity(sqrtPriceX96, sqrtRatioBX96, liquidity)
        amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtPriceX96, liquidity)
    } else {
        amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    }

    return [amount0, amount1]
}


export function handleInitialize(event: Initialize): void {
    let hookAddress = event.params.hooks

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

    pool.liquidity = ZERO_BI
    pool.reserve0 = ZERO_BI
    pool.reserve1 = ZERO_BI

    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = event.params.tick

    pool.save()
    createTVLSnapshot(pool, event)
}


export function handleModifyLiquidity(event: ModifyLiquidity): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        // Pool not initialized with DeliSwap hooks.
        return
    }

    if (pool.type == "V2") {
        // V2 logic is handled by V2 hooks (v2hook.ts and v2positionHandler.ts)
        return
    }

    // V4 Logic:
    // ModifyLiquidity event does not include the current price/tick, which are essential for V4 math.
    // We must fetch the current state from the contract to accurately calculate amounts and reserves.

    let pmContract = PoolManager.bind(event.address)
    // Call getSlot0(bytes32 id) which returns (uint160 sqrtPriceX96, int24 tick, ...)
    let slot0Result = pmContract.try_getSlot0(event.params.id)

    if (slot0Result.reverted) {
        log.error("Could not fetch slot0 for pool {} in handleModifyLiquidity. TxHash: {}", [poolId, event.transaction.hash.toHexString()])
        // If getSlot0 fails, we attempt to rely on the stored state.
        if (pool.sqrtPrice == null || pool.tick == null) {
            // If no state is stored either (e.g., first liquidity event after initialization), we cannot proceed.
            log.error("Pool {} has no stored price/tick and getSlot0 reverted. Cannot process V4 ModifyLiquidity.", [poolId])
            return
        }
        // Proceed using potentially stale data if call failed but data exists.
    } else {
        // Update pool state with the latest info fetched from the contract.
        // This ensures accuracy even if a Swap occurred in the same transaction before this event.
        // value0 is sqrtPriceX96, value1 is tick.
        pool.sqrtPrice = slot0Result.value.value0
        pool.tick = slot0Result.value.value1
        // pool.save() is called at the end.
    }


    let liquidityDelta = event.params.liquidityDelta
    let senderAddress = event.params.sender
    let tickLower = event.params.tickLower
    let tickUpper = event.params.tickUpper
    let salt = event.params.salt

    let user: User
    let position: Position | null

    // Calculate V4 MINT/BURN amounts (amount0/amount1) using V4 math.
    let amounts = calculateV4ActionAmounts(pool, tickLower, tickUpper, liquidityDelta)
    let amount0 = amounts[0]
    let amount1 = amounts[1]

    // Determine position type and owner
    if (senderAddress.equals(V4_POSITION_MANAGER_ADDRESS)) {
        // Case 1: NFT Position (managed via PositionManager)
        let tokenId = salt.toBigInt() // TokenId is used as salt
        let positionId = tokenId.toString()

        let pmContract = PositionManager.bind(V4_POSITION_MANAGER_ADDRESS)
        let ownerResult = pmContract.try_ownerOf(tokenId)

        let existingPosition = Position.load(positionId)

        // Determine the owner of the NFT
        if (ownerResult.reverted) {
            // ownerOf reverts if the token doesn't exist (e.g., just burned or not yet minted).
            if (existingPosition != null && liquidityDelta.lt(ZERO_BI)) {
                // If it's a decrease/burn and the position existed, use the previous owner for the action.
                user = loadOrCreateUser(Address.fromString(existingPosition.user))
            } else {
                // If it's a mint, the owner is not yet set. Use the transaction originator as the likely actor.
                // The Position entity owner will be confirmed by the Transfer event handler later.
                log.info("Owner of V4 NFT {} unknown (Reverted) during MINT. Using tx.origin. TxHash: {}", [positionId, event.transaction.hash.toHexString()])
                user = loadOrCreateUser(event.transaction.from)
            }
        } else {
            user = loadOrCreateUser(ownerResult.value)
        }

        position = existingPosition
        if (position == null) {
            // New position (MINT_POSITION)
            position = new Position(positionId)
            position.pool = pool.id
            position.tokenId = tokenId
            position.tickLower = tickLower
            position.tickUpper = tickUpper
            position.liquidity = ZERO_BI
            position.reserve0 = ZERO_BI
            position.reserve1 = ZERO_BI
        }
        // Update the user field. If it's a mint and we used tx.origin, this might be temporary until Transfer event.
        position.user = user.id


    } else {
        // Case 2: Non-NFT Position (Direct PoolManager interaction)
        user = loadOrCreateUser(senderAddress)

        // Use a unique key for the position identifier (owner-tickLower-tickUpper-salt)
        let positionId = senderAddress.toHexString() + "-" + tickLower.toString() + "-" + tickUpper.toString() + "-" + salt.toHexString()
        log.info("Tracking Non-NFT V4 Position. ID: {}", [positionId])

        position = Position.load(positionId)
        if (position == null) {
            position = new Position(positionId)
            position.pool = pool.id
            position.user = user.id
            position.tokenId = null // Non-NFT
            position.tickLower = tickLower
            position.tickUpper = tickUpper
            position.liquidity = ZERO_BI
            position.reserve0 = ZERO_BI
            position.reserve1 = ZERO_BI
        }
    }

    // Update position liquidity
    position.liquidity = position.liquidity.plus(liquidityDelta)


    // Update V4 position reserves (User TVL: reserve0/reserve1).
    updateV4PositionReserves(position, pool)
    // position.save() is called within updateV4PositionReserves.


    // Create Action entity
    let actionType = liquidityDelta.gt(ZERO_BI) ? "MINT" : "BURN"
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()

    let action = new Action(actionId)
    action.type = actionType
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = user.id

    // Use calculated V4 amounts (positive magnitude).
    action.amount0 = amount0
    action.amount1 = amount1

    action.save()

    // Update pool total reserves (TVL) for V4.
    if (liquidityDelta.gt(ZERO_BI)) {
        // MINT: Reserves increase
        pool.reserve0 = pool.reserve0.plus(amount0)
        pool.reserve1 = pool.reserve1.plus(amount1)
    } else {
        // BURN: Reserves decrease
        pool.reserve0 = pool.reserve0.minus(amount0)
        pool.reserve1 = pool.reserve1.minus(amount1)
    }

    // Update active liquidity (pool.liquidity) ONLY if the modification range includes the current tick.
    if (pool.tick != null && pool.tick! >= tickLower && pool.tick! < tickUpper) {
        pool.liquidity = pool.liquidity.plus(liquidityDelta)
    }

    pool.save()
    createTVLSnapshot(pool, event)
}

export function handleSwap(event: Swap): void {
    let poolId = event.params.id.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    let sender = loadOrCreateUser(event.params.sender)

    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    let amount0In = amount0.gt(ZERO_BI) ? amount0 : ZERO_BI
    let amount1In = amount1.gt(ZERO_BI) ? amount1 : ZERO_BI
    let amount0Out = amount0.lt(ZERO_BI) ? amount0.abs() : ZERO_BI
    let amount1Out = amount1.lt(ZERO_BI) ? amount1.abs() : ZERO_BI

    let tokenInId = amount0In.gt(ZERO_BI) ? pool.token0 : pool.token1
    let tokenOutId = amount0Out.gt(ZERO_BI) ? pool.token0 : pool.token1
    let amountIn = amount0In.gt(ZERO_BI) ? amount0In : amount1In
    let amountOut = amount0Out.gt(ZERO_BI) ? amount0Out : amount1Out

    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "SWAP"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    // Signed delta
    action.amount0 = amount0
    action.amount1 = amount1

    action.tokenIn = tokenInId
    action.tokenOut = tokenOutId
    action.amountIn = amountIn
    action.amountOut = amountOut

    action.isBuyToken0 = amount0Out.gt(ZERO_BI)
    action.isBuyToken1 = amount1Out.gt(ZERO_BI)

    action.save()

    // Update pool state (Price and Tick)
    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = event.params.tick

    if (pool.type == "V4") {
        // Update active liquidity
        pool.liquidity = event.params.liquidity

        // Update total reserves based on swap amounts
        pool.reserve0 = pool.reserve0.plus(amount0)
        pool.reserve1 = pool.reserve1.plus(amount1)

        pool.save()

        // Since the price changed, we must update reserves for all V4 positions in this pool.
        // Note: This is computationally expensive but required for accurate User TVL tracking.
        let positions = pool.positions.load()
        for (let i = 0; i < positions.length; i++) {
            // Ensure we are only updating V4 positions (though pool.type check already ensures this)
            if (positions[i].tickLower != null) {
                updateV4PositionReserves(positions[i], pool)
            }
        }

        createTVLSnapshot(pool, event)
    }

    if (pool.type == "V2") {
        // V2 reserves are updated via Sync event in v2hook.ts
        // We save the pool here only to update price/tick information derived from the underlying V4 pool.
        pool.save()
    }
}
