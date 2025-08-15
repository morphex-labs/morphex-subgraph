import { Address, BigDecimal, BigInt, Bytes, log, ethereum } from "@graphprotocol/graph-ts"
import {
    Initialize,
    ModifyLiquidity,
    Swap
} from "../generated/PoolManager/PoolManager"
import { PositionManager } from "../generated/PoolManager/PositionManager"
import { Pool, Action, Position, User } from "../generated/schema"
import { DELI_HOOK_V2_ADDRESS, DELI_HOOK_V4_ADDRESS, V4_POSITION_MANAGER_ADDRESS, ZERO_BI } from "./constants"
import { loadOrCreateToken, loadOrCreateUser, createTVLSnapshot } from "./helpers"

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
        return
    }

    if (pool.type == "V2") {
        return
    }

    let liquidityDelta = event.params.liquidityDelta
    let senderAddress = event.params.sender
    let tickLower = event.params.tickLower
    let tickUpper = event.params.tickUpper

    let user: User

    if (senderAddress.equals(V4_POSITION_MANAGER_ADDRESS)) {
        let tokenId = event.params.salt.toBigInt()
        let positionId = tokenId.toString()

        let pmContract = PositionManager.bind(V4_POSITION_MANAGER_ADDRESS)
        let ownerResult = pmContract.try_ownerOf(tokenId)

        let existingPosition = Position.load(positionId)

        if (ownerResult.reverted) {
            if (existingPosition != null && liquidityDelta.lt(ZERO_BI)) {
                user = loadOrCreateUser(Address.fromString(existingPosition.user))
            } else {
                log.error("Could not determine owner of V4 Position NFT: {} (Reverted). TxHash: {}", [positionId, event.transaction.hash.toHexString()])
                user = loadOrCreateUser(senderAddress)
            }
        } else {
            user = loadOrCreateUser(ownerResult.value)
        }

        let position = existingPosition
        if (position == null) {
            position = new Position(positionId)
            position.pool = pool.id
            position.tokenId = tokenId
            position.tickLower = tickLower
            position.tickUpper = tickUpper
            position.liquidity = ZERO_BI
            position.reserve0 = ZERO_BI
            position.reserve1 = ZERO_BI
        }
        position.user = user.id
        position.liquidity = position.liquidity.plus(liquidityDelta)

        // TODO: Update V4 position reserves (User TVL: reserve0/reserve1).
        // This requires complex calculations based on the current price, ticks, and liquidity.
        // V4 User TVL tracking is deferred due to complexity.

        position.save()

    } else {
        user = loadOrCreateUser(senderAddress)

        // TODO: Implement tracking for non-NFT V4 positions if required. This requires tracking positions based on sender + salt.
        log.warning("Direct PoolManager liquidity modification detected. Non-NFT Position tracking not implemented. Pool: {}, Sender: {}, Salt: {}", [poolId, senderAddress.toHexString(), event.params.salt.toHexString()])
    }


    let actionType = liquidityDelta.gt(ZERO_BI) ? "MINT" : "BURN"
    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()

    let action = new Action(actionId)
    action.type = actionType
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = user.id

    // TODO: Investigate decoding transaction input from PositionManager calls, V4 amounts are critical.
    action.amount0 = ZERO_BI
    action.amount1 = ZERO_BI

    action.save()

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

    action.amount0 = amount0
    action.amount1 = amount1

    action.tokenIn = tokenInId
    action.tokenOut = tokenOutId
    action.amountIn = amountIn
    action.amountOut = amountOut

    action.isBuyToken0 = amount0Out.gt(ZERO_BI)
    action.isBuyToken1 = amount1Out.gt(ZERO_BI)

    action.save()

    pool.sqrtPrice = event.params.sqrtPriceX96
    pool.tick = event.params.tick

    if (pool.type == "V4") {
        pool.liquidity = event.params.liquidity

        pool.reserve0 = pool.reserve0.plus(amount0)
        pool.reserve1 = pool.reserve1.plus(amount1)

        pool.save()
        createTVLSnapshot(pool, event)
    }

    if (pool.type == "V2") {
        pool.save()
    }
}
