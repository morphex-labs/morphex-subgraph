import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts"

export const ADDRESS_ZERO = Address.fromString("0x0000000000000000000000000000000000000000")

// DeliSwap Hook Addresses (Base) - Used for filtering pools in PoolManager
export const DELI_HOOK_V2_ADDRESS = Address.fromString("0x10f5D70061072709E4C0F6B3f0fD64B38E12BACC")
export const DELI_HOOK_V4_ADDRESS = Address.fromString("0x66989C71705deBB446D6B83D76cbABDd502Cb0cC")

// V4 Position Manager (Base) - Used to identify V4 position modifications in PoolManager and look up NFT owners
export const V4_POSITION_MANAGER_ADDRESS = Address.fromString("0x7C5f5A4bBd8fD63184577525326123B519429bDc")

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString("0")
export let ONE_BD = BigDecimal.fromString("1")
