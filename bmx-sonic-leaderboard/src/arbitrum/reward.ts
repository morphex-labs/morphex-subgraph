import * as erc20 from "../../generated/transferGmx/ERC20"
import { getTokenUsdAmount, _storeERC20Transfer, TokenDecimals, getIdFromEvent } from "../helpers"
import { SLT, BMX } from "./constant"

export function handleGmxTransfer(event: erc20.Transfer): void {
  const amountUsd = getTokenUsdAmount(event.params.value, BMX, TokenDecimals.BMX)
  _storeERC20Transfer(BMX, event, amountUsd)
}

export function handleGlpTransfer(event: erc20.Transfer): void {
  const amountUsd = getTokenUsdAmount(event.params.value, SLT, TokenDecimals.SLT)
  _storeERC20Transfer(SLT, event, amountUsd)
}
