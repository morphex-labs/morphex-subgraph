import { Transfer } from "../generated/PositionManager/PositionManager"
import { Position } from "../generated/schema"
import { ADDRESS_ZERO } from "./constants"
import { log } from "@graphprotocol/graph-ts"
import { loadOrCreateUser } from "./helpers"

export function handleTransfer(event: Transfer): void {
    let tokenId = event.params.tokenId
    let from = event.params.from
    let to = event.params.to
    let positionId = tokenId.toString()

    if (from.equals(ADDRESS_ZERO)) {
        log.info("V4 Position NFT Minted. TokenId: {}", [positionId])
        loadOrCreateUser(to)
        let position = Position.load(positionId)
        if (position != null) {
            let user = loadOrCreateUser(to)
            position.user = user.id
            position.save()
        }
        return
    }

    if (to.equals(ADDRESS_ZERO)) {
        log.info("V4 Position NFT Burned. TokenId: {}", [positionId])
        return
    }

    let position = Position.load(positionId)
    if (position != null) {
        let newUser = loadOrCreateUser(to)
        position.user = newUser.id
        position.save()
        log.info("V4 Position NFT Transferred. TokenId: {}, From: {}, To: {}", [positionId, from.toHexString(), to.toHexString()])
    } else {
        log.warning("V4 Position NFT Transfer for unknown position entity. TokenId: {}. MINT ModifyLiquidity might not have been processed yet.", [positionId])
        loadOrCreateUser(to)
    }
}
