import {
    V2PositionCreated,
    V2PositionModified,
    V2PositionRemoved
} from "../generated/V2PositionHandler/V2PositionHandler"
import { Pool, Position } from "../generated/schema"
import { ZERO_BI } from "./constants"
import { log } from "@graphprotocol/graph-ts"
import { loadOrCreateUser } from "./helpers"
import { updateV2PositionReserves } from "./v2hook"


export function handleV2PositionCreated(event: V2PositionCreated): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let user = loadOrCreateUser(event.params.owner)
    let tokenId = event.params.tokenId

    let positionId = tokenId.toString()

    let position = new Position(positionId)
    position.pool = pool.id
    position.user = user.id
    position.tokenId = tokenId

    position.liquidity = ZERO_BI
    position.reserve0 = ZERO_BI
    position.reserve1 = ZERO_BI

    position.save()
}

export function handleV2PositionModified(event: V2PositionModified): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let tokenId = event.params.tokenId
    let positionId = tokenId.toString()
    let position = Position.load(positionId)

    if (position == null) {
        log.warning("V2 Position Modified before creation event processed: {}", [positionId])
        return
    }

    let liquidityDelta = event.params.liquidityDelta

    position.liquidity = position.liquidity.plus(liquidityDelta)

    pool.liquidity = pool.liquidity.plus(liquidityDelta)
    pool.save()

    updateV2PositionReserves(position, pool)
}

export function handleV2PositionRemoved(event: V2PositionRemoved): void {
    let poolId = event.params.poolId.toHexString()
    let pool = Pool.load(poolId)
    if (pool == null) return

    let tokenId = event.params.tokenId
    let positionId = tokenId.toString()
    let position = Position.load(positionId)

    if (position == null) return

    pool.liquidity = pool.liquidity.minus(position.liquidity)
    pool.save()

    position.liquidity = ZERO_BI
    updateV2PositionReserves(position, pool)
}
