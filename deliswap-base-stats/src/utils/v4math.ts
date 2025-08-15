import { BigInt, log } from "@graphprotocol/graph-ts"

// =================================================================================================
// V4 Math Helpers (Uniswap V3/V4)
// Implementation derived from:
// https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
// https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/LiquidityAmounts.sol
// https://github.com/Uniswap/v3-sdk/blob/main/src/utils/tickMath.ts
// =================================================================================================


// Constants from TickMath
export const MIN_TICK: i32 = -887272
export const MAX_TICK: i32 = 887272

// Q96
const Q96 = BigInt.fromString("79228162514264337593543950336") // 2^96

// Implementation of getSqrtRatioAtTick (TickMath.sol)
// Calculates sqrt(1.0001^tick) * 2^96
export function getSqrtRatioAtTick(tick: i32): BigInt {
    const absTick: u32 = u32(abs(tick))
    if (absTick > u32(MAX_TICK)) {
        // This should ideally not happen if the protocol events provide valid ticks.
        log.warning("TICK_OUT_OF_RANGE: {}", [tick.toString()])
        // Return 0 to indicate an error, callers should check.
        return BigInt.fromI32(0)
    }

    let ratio: BigInt
    // Initialize ratio based on the least significant bit of absTick
    if ((absTick & 0x1) != 0) {
        // sqrt(1.0001) * 2^96
        ratio = BigInt.fromString('79232121774732811068063666218')
    } else {
        // 1 * 2^96
        ratio = Q96
    }

    // Iteratively multiply by precomputed powers of sqrt(1.0001) and shift right by 96 bits (divide by 2^96)
    // This keeps the result in Q96 format. We use integer division `div(Q96)` instead of rightShift(96) for AssemblyScript BigInt.
    if ((absTick & 0x2) != 0) ratio = ratio.times(BigInt.fromString('79236081434433616611724032312')).div(Q96)
    if ((absTick & 0x4) != 0) ratio = ratio.times(BigInt.fromString('79244001867961637630366820881')).div(Q96)
    if ((absTick & 0x8) != 0) ratio = ratio.times(BigInt.fromString('79260015158363214176789631673')).div(Q96)
    if ((absTick & 0x10) != 0) ratio = ratio.times(BigInt.fromString('79292085822878345382416793355')).div(Q96)
    if ((absTick & 0x20) != 0) ratio = ratio.times(BigInt.fromString('79356497474841786099453666623')).div(Q96)
    if ((absTick & 0x40) != 0) ratio = ratio.times(BigInt.fromString('79486265648658354900967888278')).div(Q96)
    if ((absTick & 0x80) != 0) ratio = ratio.times(BigInt.fromString('79748108877230127324681066509')).div(Q96)
    if ((absTick & 0x100) != 0) ratio = ratio.times(BigInt.fromString('80276253662538624663694482689')).div(Q96)
    if ((absTick & 0x200) != 0) ratio = ratio.times(BigInt.fromString('81351004109847546265034409086')).div(Q96)
    if ((absTick & 0x400) != 0) ratio = ratio.times(BigInt.fromString('83553947072966723528393886293')).div(Q96)
    if ((absTick & 0x800) != 0) ratio = ratio.times(BigInt.fromString('88153538017231974436454821671')).div(Q96)
    if ((absTick & 0x1000) != 0) ratio = ratio.times(BigInt.fromString('97741318766014864987372344373')).div(Q96)
    if ((absTick & 0x2000) != 0) ratio = ratio.times(BigInt.fromString('119432961668523944791028098571')).div(Q96)
    if ((absTick & 0x4000) != 0) ratio = ratio.times(BigInt.fromString('178487117895580519420042081526')).div(Q96)
    if ((absTick & 0x8000) != 0) ratio = ratio.times(BigInt.fromString('400998097280158050237080223103')).div(Q96)
    if ((absTick & 0x10000) != 0) ratio = ratio.times(BigInt.fromString('2029004603309865751419662319734')).div(Q96)
    if ((absTick & 0x20000) != 0) ratio = ratio.times(BigInt.fromString('51975918489147640749780866598673')).div(Q96)
    if ((absTick & 0x40000) != 0) ratio = ratio.times(BigInt.fromString('340794827117749127845000920289708')).div(Q96)
    if ((absTick & 0x80000) != 0) ratio = ratio.times(BigInt.fromString('1461446703485210103287273052203988822378723970341')).div(Q96)


    if (tick < 0) {
        // Invert the ratio: ratio = 1 / ratio.
        // Since ratio is Q96, we calculate (2^192) / ratio to get the inverted Q96 ratio.
        const Q192 = Q96.times(Q96)
        ratio = Q192.div(ratio)
    }

    return ratio
}

// Functions to calculate amounts (from LiquidityAmounts.sol)

// Calculates the amount of token0 for a given amount of liquidity and price range.
// amount0 = liquidity * (sqrt(P_b) - sqrt(P_a)) / (sqrt(P_a) * sqrt(P_b))
// amount0 = liquidity * (sqrtRatioBX96 - sqrtRatioAX96) * 2^96 / (sqrtRatioAX96 * sqrtRatioBX96)
export function getAmount0ForLiquidity(sqrtRatioAX96: BigInt, sqrtRatioBX96: BigInt, liquidity: BigInt): BigInt {
    if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
        let temp = sqrtRatioAX96
        sqrtRatioAX96 = sqrtRatioBX96
        sqrtRatioBX96 = temp
    }

    let numerator1 = liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96))
    // Multiply by 2^96
    numerator1 = numerator1.times(Q96)

    let denominator = sqrtRatioAX96.times(sqrtRatioBX96)

    // We perform division last to maintain precision
    if (denominator.equals(BigInt.fromI32(0))) return BigInt.fromI32(0)
    return numerator1.div(denominator)
}

// Calculates the amount of token1 for a given amount of liquidity and price range.
// amount1 = liquidity * (sqrt(P_b) - sqrt(P_a))
// amount1 = liquidity * (sqrtRatioBX96 - sqrtRatioAX96) / 2^96
export function getAmount1ForLiquidity(sqrtRatioAX96: BigInt, sqrtRatioBX96: BigInt, liquidity: BigInt): BigInt {
    if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
        let temp = sqrtRatioAX96
        sqrtRatioAX96 = sqrtRatioBX96
        sqrtRatioBX96 = temp
    }

    let numerator = liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96))

    // Divide by 2^96
    return numerator.div(Q96)
}
