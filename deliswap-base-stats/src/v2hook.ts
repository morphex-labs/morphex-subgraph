import { Sync, Mint, Burn } from "../generated/DeliHookConstantProduct/DeliHookConstantProduct"
import { Pool, Action, Position } from "../generated/schema"
import { ZERO_BI } from "./constants"
import { loadOrCreateUser, createTVLSnapshot } from "./helpers"
import { BigInt, ethereum } from "@graphprotocol/graph-ts"

function updatePoolTVL_V2(pool: Pool, reserve0: BigInt, reserve1: BigInt, event: ethereum.Event): void {
    pool.reserve0 = reserve0
    pool.reserve1 = reserve1

    pool.save()

    createTVLSnapshot(pool, event)

    let positions = pool.positions.load()
    for (let i = 0; i < positions.length; i++) {
        updateV2PositionReserves(positions[i], pool)
    }
}

export function updateV2PositionReserves(position: Position, pool: Pool): void {
    if (pool.liquidity.gt(ZERO_BI) && position.liquidity.gt(ZERO_BI)) {
        position.reserve0 = pool.reserve0.times(position.liquidity).div(pool.liquidity)
        position.reserve1 = pool.reserve1.times(position.liquidity).div(pool.liquidity)
    } else {
        position.reserve0 = ZERO_BI
        position.reserve1 = ZERO_BI
    }
    position.save()
}


export function handleSync(event: Sync): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)

    if (pool == null) {
        return
    }

    updatePoolTVL_V2(pool, event.params.reserve0, event.params.reserve1, event)
}

export function handleV2Mint(event: Mint): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "MINT"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    action.amount0 = amount0
    action.amount1 = amount1

    action.save()
}

export function handleV2Burn(event: Burn): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let sender = loadOrCreateUser(event.params.sender)
    let amount0 = event.params.amount0
    let amount1 = event.params.amount1

    let actionId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
    let action = new Action(actionId)
    action.type = "BURN"
    action.timestamp = event.block.timestamp
    action.blockNumber = event.block.number
    action.transactionHash = event.transaction.hash
    action.pool = pool.id
    action.user = sender.id

    action.amount0 = amount0
    action.amount1 = amount1

    action.save()
}
