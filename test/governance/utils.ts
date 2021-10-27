import { BigNumber } from "ethers";

export const DELAY = 60 * 60 * 24 * 2;

export async function mineBlock(
  provider: any,
  timestamp: number
): Promise<void> {
  return provider.send("evm_mine", [timestamp]);
}

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18));
}
