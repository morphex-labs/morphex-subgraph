import { BigInt, Address } from "@graphprotocol/graph-ts"

import {
  ChainlinkPrice,
  FastPrice
} from "../generated/schema"

import {
  WBTC,
  WETH,
  WBNB,
  timestampToPeriod,
  USDC,
  XRP,
  CAKE,
  ADA,
  USDT
} from "./helpers"

import {
  AnswerUpdated as AnswerUpdatedEvent
} from '../generated/ChainlinkAggregatorBTC/ChainlinkAggregator'

import {
  PriceUpdate
} from '../generated/FastPriceEvents/FastPriceEvents'

function _storeChainlinkPrice(token: string, value: BigInt, timestamp: BigInt, blockNumber: BigInt): void {
  let id = token + ":" + timestamp.toString()
  let entity = new ChainlinkPrice(id)
  entity.value = value
  entity.period = "any"
  entity.token = token
  entity.blockNumber = blockNumber.toI32()
  entity.timestamp = timestamp.toI32()
  entity.save()

  let totalEntity = new ChainlinkPrice(token)
  totalEntity.value = value
  totalEntity.period = "last"
  totalEntity.token = token
  totalEntity.blockNumber = blockNumber.toI32()
  totalEntity.timestamp = timestamp.toI32()
  totalEntity.save()
}

export function handleAnswerUpdatedBTC(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(WBTC, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedETH(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(WETH, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedADABNB(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(ADA, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedBNBAndADA(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(WBNB, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedUSDC(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(USDC, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedCAKE(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(CAKE, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedXRP(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(XRP, event.params.current, event.block.timestamp, event.block.number)
}

export function handleAnswerUpdatedUSDT(event: AnswerUpdatedEvent): void {
  _storeChainlinkPrice(USDT, event.params.current, event.block.timestamp, event.block.number)
}

function _handleFastPriceUpdate(token: Address, price: BigInt, timestamp: BigInt, blockNumber: BigInt): void {
  let dailyTimestampGroup = timestampToPeriod(timestamp, "daily")
  _storeFastPrice(dailyTimestampGroup.toString() + ":daily:" + token.toHexString(), token, price, dailyTimestampGroup, blockNumber, "daily")

  let hourlyTimestampGroup = timestampToPeriod(timestamp, "hourly")
  _storeFastPrice(hourlyTimestampGroup.toString() + ":hourly:" + token.toHexString(), token, price, hourlyTimestampGroup, blockNumber, "hourly")

  _storeFastPrice(timestamp.toString() + ":any:" + token.toHexString(), token, price, timestamp, blockNumber, "any")
  _storeFastPrice(token.toHexString(), token, price, timestamp, blockNumber, "last")
}

function _storeFastPrice(id: string, token: Address, price: BigInt, timestampGroup: BigInt, blockNumber: BigInt, period: string): void {
  let entity = new FastPrice(id)
  entity.period = period
  entity.value = price
  entity.token = token.toHexString()
  entity.timestamp = timestampGroup.toI32()
  entity.blockNumber = blockNumber.toI32()
  entity.save()
}

export function handlePriceUpdate(event: PriceUpdate): void {
  _handleFastPriceUpdate(event.params.token, event.params.price, event.block.timestamp, event.block.number)
}

