import { Transfer } from "../generated/PositionManager/PositionManager"
import { Position } from "../generated/schema"
import { ADDRESS_ZERO } from "./constants"
import { log } from "@graphprotocol/graph-ts"
import { loadOrCreateUser } from "./helpers"

// Handle V4 NFT Transfers (Ownership changes, Mint/Burn tracking)
// This handler tracks the ownership of V4 Positions based on NFT transfers.
// The creation and liquidity updates of the Position entity happen in PoolManager.handleModifyLiquidity.

export function handleTransfer(event: Transfer): void {
    let tokenId = event.params.tokenId
    let from = event.params.from
    let to = event.params.to
    let positionId = tokenId.toString()

    // Case 1: Mint (Creation)
    if (from.equals(ADDRESS_ZERO)) {
        // The Position entity is primarily created and initialized in the PoolManager.handleModifyLiquidity handler,
        // which uses the tokenId (as salt) and determines the owner via contract call.
        log.info("V4 Position NFT Minted. TokenId: {}", [positionId])
        // We ensure the recipient user entity exists.
        loadOrCreateUser(to)
        // If the Position entity already exists (ModifyLiquidity ran first), we ensure the owner is correct.
        let position = Position.load(positionId)
        if (position != null) {
            let user = loadOrCreateUser(to)
            position.user = user.id
            position.save()
        }
        return
    }

    // Case 2: Burn (Destruction)
    if (to.equals(ADDRESS_ZERO)) {
        // The Position entity state (liquidity=0) is updated in the PoolManager.handleModifyLiquidity handler.
        log.info("V4 Position NFT Burned. TokenId: {}", [positionId])
        // We don't delete the entity here to preserve historical data, but its liquidity should be 0.
        return
    }

    // Case 3: Transfer (Ownership change)
    let position = Position.load(positionId)
    if (position != null) {
        // Update the owner of the position entity.
        let newUser = loadOrCreateUser(to)
        position.user = newUser.id
        position.save()
        log.info("V4 Position NFT Transferred. TokenId: {}, From: {}, To: {}", [positionId, from.toHexString(), to.toHexString()])
    } else {
        // This should ideally not happen if the PoolManager.ModifyLiquidity for creation (MINT) was processed correctly before the Transfer.
        log.warning("V4 Position NFT Transfer for unknown position entity. TokenId: {}. MINT ModifyLiquidity might not have been processed yet.", [positionId])
        // We ensure the recipient user entity exists even if the position entity is not yet indexed.
        loadOrCreateUser(to)
    }
}
