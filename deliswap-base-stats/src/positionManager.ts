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

    // Mint event (from ADDRESS_ZERO)
    if (from.equals(ADDRESS_ZERO)) {
        log.info("V4 Position NFT Minted. TokenId: {}", [positionId])
        let user = loadOrCreateUser(to)

        // The position entity is created/updated by handleModifyLiquidity, which runs before Transfer in the same tx.
        // We ensure the owner is correctly set here, finalizing the owner identified in handleModifyLiquidity.
        let position = Position.load(positionId)
        if (position != null) {
            position.user = user.id
            position.save()
        } else {
            // This might happen if subgraph processing order differs, but handleModifyLiquidity should eventually create it.
            log.warning("V4 Position NFT Minted but Position entity not found yet. TokenId: {}.", [positionId])
        }
        return
    }

    // Burn event (to ADDRESS_ZERO)
    if (to.equals(ADDRESS_ZERO)) {
        log.info("V4 Position NFT Burned. TokenId: {}", [positionId])
        // Liquidity should be zeroed out by handleModifyLiquidity.
        return
    }

    // Transfer event
    let position = Position.load(positionId)
    if (position != null) {
        let newUser = loadOrCreateUser(to)
        position.user = newUser.id
        // Reserves do not change on transfer.
        position.save()
        log.info("V4 Position NFT Transferred. TokenId: {}, From: {}, To: {}", [positionId, from.toHexString(), to.toHexString()])
    } else {
        log.warning("V4 Position NFT Transfer for unknown position entity. TokenId: {}. MINT ModifyLiquidity might not have been processed yet.", [positionId])
        loadOrCreateUser(to)
    }
}
