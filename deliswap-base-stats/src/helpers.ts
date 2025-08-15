import { Address, BigInt, Bytes, dataSource, ethereum, BigDecimal } from "@graphprotocol/graph-ts"
import { ERC20 } from "../generated/PoolManager/ERC20"
import { Token, User } from "../generated/schema"
import { ZERO_BI, ZERO_BD } from "./constants"

// Helper functions to safely fetch token details
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
    // Ensure the result fits in i32 as required by schema
    if (decimalResult.value.toU64() > 255) {
        return BigInt.fromI32(18)
    }
    return BigInt.fromI32(decimalResult.value as i32)
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
    let contract = ERC20.bind(tokenAddress)
    let totalSupplyResult = contract.try_totalSupply()
    if (totalSupplyResult.reverted) {
        return ZERO_BI
    }
    return totalSupplyResult.value
}

// Load or create Token entity
export function loadOrCreateToken(tokenAddress: Address): Token {
    let token = Token.load(tokenAddress.toHexString())
    if (token == null) {
        token = new Token(tokenAddress.toHexString())
        token.symbol = fetchTokenSymbol(tokenAddress)
        token.name = fetchTokenName(tokenAddress)
        token.decimals = fetchTokenDecimals(tokenAddress).toI32()
        token.totalSupply = fetchTokenTotalSupply(tokenAddress)
        token.totalValueLockedUSD = ZERO_BD
        token.save()
    }
    return token
}

// Load or create User entity
export function loadOrCreateUser(userAddress: Address): User {
    let user = User.load(userAddress.toHexString())
    if (user == null) {
        user = new User(userAddress.toHexString())
        user.save()
    }
    return user
}

// --- Pricing and TVL Calculation ---

// TODO: Implement robust pricing logic.
export function getPriceUSD(token: Token): BigDecimal {
    // Placeholder implementation.
    return ZERO_BD
}

// Calculate the USD value of two token amounts
export function calculateAmountUSD(token0: Token, amount0: BigInt, token1: Token, amount1: BigInt): BigDecimal {
    // TODO: Replace placeholder implementation once getPriceUSD is implemented.
    return ZERO_BD
}
