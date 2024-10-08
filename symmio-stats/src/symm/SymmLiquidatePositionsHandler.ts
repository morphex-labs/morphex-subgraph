import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts"
import { LiquidatePositionsPartyA, v3 } from "../../generated/SymmDataSource/v3"
import { Quote } from "../../generated/schema"
import { zero_address } from "../solidly/utils"
import { Handler } from "./Handler"
import { updateVolume } from "./utils"

export class LiquidatePositionsHandler extends Handler {
  event: LiquidatePositionsPartyA
  user: Address

  constructor(_event: ethereum.Event) {
    super(_event)
    const event = changetype<LiquidatePositionsPartyA>(_event) // LiquidatePositionsPartyA, LiquidatePositionsPartyB have the same event signature
    this.user = super.getOwner(event.params.partyA)
    this.event = event
  }

  public handle(): void {
    if (!this.isValid) return

    const ids = this.event.params.quoteIds
    for (let i = 0; i < ids.length; i++) {
      if (super.getSymbolId(ids[i]) == BigInt.fromI32(163)) return
      this._handle(ids[i])
    }
  }

  private _handle(quoteId: BigInt): void {
    if (this.user == zero_address) return
    const volumeInDollars = this.getVolume(quoteId, this.week)
    updateVolume(this.user, this.day, this.week, volumeInDollars, this.timestamp) // user volume tracker
    updateVolume(Address.fromBytes(zero_address), this.day, this.week, volumeInDollars, this.timestamp) // total volume tracker
  }

  public getVolume(quoteId: BigInt, week: BigInt): BigInt {
    const quote = Quote.load(this.getQuoteObjectId(quoteId))

    if (quote == null) return BigInt.zero() //FIXME

    let symmioContract = v3.bind(this.event.address)

    const callResult = symmioContract.try_getQuote(quoteId)
    if (callResult.reverted) return BigInt.zero() //FIXME
    let chainQuote = callResult.value
    const liquidAmount = quote.quantity.minus(quote.closedAmount)
    const liquidPrice = chainQuote.avgClosedPrice
      .times(quote.quantity)
      .minus(quote.avgClosedPrice.times(quote.closedAmount))
      .div(liquidAmount)
    if (week.le(BigInt.fromI32(1))) { // this maintains backwards compatibility on incorrectly counted epochs
      return liquidAmount
          .times(liquidPrice)
          .times(BigInt.fromI32(4))
          .div(BigInt.fromString("10").pow(18))
    } else {
      return liquidAmount
          .times(liquidPrice)
          .div(BigInt.fromString("10").pow(18))
    }
  }
}
