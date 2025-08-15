import { Address, BigInt, Bytes, dataSource, ethereum, BigDecimal } from "@graphprotocol/graph-ts"
import { ERC20 } from "../generated/PoolManager/ERC20"
import { Token, User, Pool, TVLSnapshot } from "../generated/schema"
import { ZERO_BI, ZERO_BD } from "./constants"

export function fetchTokenSymbol(tokenAddress: Address): string {
    let contract = ERC20.bind(tokenAddress)
    let symbolResult = contract.try_symbol()
    if (symbolResult.reverted) {
        return "UNKNOWN"
    }
    return symbolResult.value
}

export function fetchTokenName(tokenAddress: Address): string {
    let contract = ERC20.bind(tokenAddress)
    let nameResult = contract.try_name()
    if (nameResult.reverted) {
        return "UNKNOWN"
    }
    return nameResult.value
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
    let contract = ERC20.bind(tokenAddress)
    let decimalResult = contract.try_decimals()
    if (decimalResult.reverted) {
        return BigInt.fromI32(18)
    }
    if (decimalResult.value.toU64() > 255) {
        return BigInt.fromI32(18)
    }
    return BigInt.fromI32(decimalResult.value.toI32())
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
    let contract = ERC20.bind(tokenAddress)
    let totalSupplyResult = contract.try_totalSupply()
    if (totalSupplyResult.reverted) {
        return ZERO_BI
    }
    return totalSupplyResult.value
}

export function loadOrCreateToken(tokenAddress: Address): Token {
    let token = Token.load(tokenAddress.toHexString())
    if (token == null) {
        token = new Token(tokenAddress.toHexString())
        token.symbol = fetchTokenSymbol(tokenAddress)
        token.name = fetchTokenName(tokenAddress)
        token.decimals = fetchTokenDecimals(tokenAddress).toI32()
        token.totalSupply = fetchTokenTotalSupply(tokenAddress)
        token.save()
    }
    return token
}

export function loadOrCreateUser(userAddress: Address): User {
    let user = User.load(userAddress.toHexString())
    if (user == null) {
        user = new User(userAddress.toHexString())
        user.save()
    }
    return user
}

export function createTVLSnapshot(pool: Pool, event: ethereum.Event): void {
    let snapshotId = pool.id + "-" + event.block.timestamp.toString()
    let snapshot = TVLSnapshot.load(snapshotId)
    if (snapshot == null) {
        snapshot = new TVLSnapshot(snapshotId)
        snapshot.pool = pool.id
        snapshot.timestamp = event.block.timestamp
        snapshot.blockNumber = event.block.number
        snapshot.liquidity = pool.liquidity
        snapshot.reserve0 = pool.reserve0
        snapshot.reserve1 = pool.reserve1
        snapshot.save()
    }
}
