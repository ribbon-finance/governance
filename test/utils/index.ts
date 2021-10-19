import { assert } from "chai";
import hardhat from "hardhat";
import { BigNumber, BigNumberish, ethers } from "ethers";
import BN from "bn.js";

import { toBN, toWei, fromWei, hexToAscii } from "web3-utils";
const UNIT = toWei(new BN("1"), "ether");

const { parseEther } = ethers.utils;

/**
 * Sets default properties on the jsonrpc object and promisifies it so we don't have to copy/paste everywhere.
 */
export const send = (payload: any): Promise<any> => {
  if (!payload.jsonrpc) payload.jsonrpc = "2.0";
  if (!payload.id) payload.id = new Date().getTime();

  return hardhat.network.provider.send(payload.method, payload.params);
};

/**
 *  Mines a single block in Ganache (evm_mine is non-standard)
 */
export const mineBlock = () => send({ method: "evm_mine" });

/**
 *  Gets the time of the last block.
 */
export const currentTime = async () => {
  const { timestamp } = await hardhat.ethers.provider.getBlock("latest");
  return timestamp;
};

/**
 *  Increases the time in the EVM.
 *  @param seconds Number of seconds to increase the time by
 */
export const fastForward = async (seconds: BigNumberish) => {
  let secondsNum: number = 0;

  // It's handy to be able to be able to pass big numbers in as we can just
  // query them from the contract, then send them back. If not changed to
  // a number, this causes much larger fast forwards than expected without error.
  if (BigNumber.isBigNumber(seconds)) secondsNum = seconds.toNumber();

  // And same with strings.
  if (typeof seconds === "string") secondsNum = parseFloat(seconds);

  if (typeof seconds === "number") secondsNum = seconds;

  let params = {
    method: "evm_increaseTime",
    params: [secondsNum],
  };

  await send(params);

  await mineBlock();
};

/**
 *  Increases the time in the EVM to as close to a specific date as possible
 *  NOTE: Because this operation figures out the amount of seconds to jump then applies that to the EVM,
 *  sometimes the result can vary by a second or two depending on how fast or slow the local EVM is responding.
 *  @param time Date object representing the desired time at the end of the operation
 */
export const fastForwardTo = async (dateTime: Date) => {
  let time = 0;

  if (typeof dateTime === "string") time = parseInt(dateTime);

  const timestamp: number = parseInt((await currentTime()).toString());
  const now = new Date(timestamp * 1000);
  if (dateTime < now)
    throw new Error(
      `Time parameter (${time}) is less than now ${now}. You can only fast forward to times in the future.`
    );

  const secondsBetween = Math.floor(
    (dateTime.getTime() - now.getTime()) / 1000
  );

  await fastForward(secondsBetween);
};

/**
 *  Takes a snapshot and returns the ID of the snapshot for restoring later.
 */
export const takeSnapshot = async () => {
  const { result } = await send({ method: "evm_snapshot" });
  await mineBlock();

  return result;
};

/**
 *  Restores a snapshot that was previously taken with takeSnapshot
 *  @param id The ID that was returned when takeSnapshot was called.
 */
export const restoreSnapshot = async (id: string) => {
  await send({
    method: "evm_revert",
    params: [id],
  });
  await mineBlock();
};

/**
 *  Translates an amount to our canonical unit. We happen to use 10^18, which means we can
 *  use the built in web3 method for convenience, but if unit ever changes in our contracts
 *  we should be able to update the conversion factor here.
 *  @param amount The amount you want to re-base to UNIT
 */
export const toUnit = (amount: string | number) =>
  parseEther(amount.toString());
export const fromUnit = (amount: BN) => fromWei(amount, "ether");

/**
 *  Convenience method to assert that an event matches a shape
 *  @param actualEventOrTransaction The transaction receipt, or event as returned in the event logs from web3
 *  @param expectedEvent The event name you expect
 *  @param expectedArgs The args you expect in object notation, e.g. { newOracle: '0x...', updatedAt: '...' }
 */
export const assertEventEqual = (
  actualEventOrTransaction: any,
  expectedEvent: any,
  expectedArgs: any
) => {
  // If they pass in a whole transaction we need to extract the first log, otherwise we already have what we need
  const event = Array.isArray(actualEventOrTransaction.logs)
    ? actualEventOrTransaction.logs[0]
    : actualEventOrTransaction;

  if (!event) {
    assert.fail("No event was generated from this transaction");
  }

  // Assert the names are the same.
  assert.strictEqual(event.event, expectedEvent);

  assertDeepEqual(event.args, expectedArgs);
  // Note: this means that if you don't assert args they'll pass regardless.
  // Ensure you pass in all the args you need to assert on.
};

export const assertEventsEqual = (
  transaction: any,
  ...expectedEventsAndArgs: any[]
) => {
  if (expectedEventsAndArgs.length % 2 > 0)
    throw new Error(
      "Please call assert.eventsEqual with names and args as pairs."
    );
  if (expectedEventsAndArgs.length <= 2)
    throw new Error(
      "Expected events and args can be called with just assert.eventEqual as there's only one event."
    );

  for (let i = 0; i < expectedEventsAndArgs.length; i += 2) {
    const log = transaction.logs[Math.floor(i / 2)];

    assert.strictEqual(
      log.event,
      expectedEventsAndArgs[i],
      "Event name mismatch"
    );
    assertDeepEqual(
      log.args,
      expectedEventsAndArgs[i + 1],
      "Event args mismatch"
    );
  }
};

/**
 *  Convenience method to assert that two BN.js instances are equal.
 *  @param actualBN The BN.js instance you received
 *  @param expectedBN The BN.js amount you expected to receive
 *  @param context The description to log if we fail the assertion
 */
export const assertBNEqual = (
  actualBN: BN | BigNumberish,
  expectedBN: BN | BigNumberish,
  context?: string
) => {
  assert.strictEqual(actualBN.toString(), expectedBN.toString(), context);
};

/**
 *  Convenience method to assert that two BN.js instances are NOT equal.
 *  @param actualBN The BN.js instance you received
 *  @param expectedBN The BN.js amount you expected NOT to receive
 *  @param context The description to log if we fail the assertion
 */
export const assertBNNotEqual = (
  actualBN: BN,
  expectedBN: BN,
  context?: string
) => {
  assert.notStrictEqual(actualBN.toString(), expectedBN.toString(), context);
};

/**
 *  Convenience method to assert that two BN.js instances are within 100 units of each other.
 *  @param actualBN The BN.js instance you received
 *  @param expectedBN The BN.js amount you expected to receive, allowing a varience of +/- 100 units
 */
export const assertBNClose = (
  actualBN: BN,
  expectedBN: BN,
  varianceParam = "10"
) => {
  const actual = BN.isBN(actualBN) ? actualBN : new BN(actualBN);
  const expected = BN.isBN(expectedBN) ? expectedBN : new BN(expectedBN);
  const variance = BN.isBN(varianceParam)
    ? varianceParam
    : new BN(varianceParam);
  const actualDelta = expected.sub(actual).abs();

  assert.ok(
    actual.gte(expected.sub(variance)),
    `Number is too small to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()}`
  );
  assert.ok(
    actual.lte(expected.add(variance)),
    `Number is too large to be close (Delta between actual and expected is ${actualDelta.toString()}, but variance was only ${variance.toString()})`
  );
};

/**
 *  Convenience method to assert that the value of left operand is greater than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
export const assertBNGreaterThan = (aBN: BigNumber, bBN: BigNumber) => {
  assert.ok(
    aBN.gt(bBN),
    `${aBN.toString()} is not greater than ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is greater than or equal then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
export const assertBNGreaterEqualThan = (aBN: BN, bBN: BN) => {
  assert.ok(
    aBN.gte(bBN),
    `${aBN.toString()} is not greater than or equal to ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is less than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
export const assertBNLessThan = (aBN: BigNumber, bBN: BigNumber) => {
  assert.ok(
    aBN.lt(bBN),
    `${aBN.toString()} is not less than ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is less than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
export const assertBNLessEqualThan = (aBN: BN, bBN: BN) => {
  assert.ok(
    aBN.lte(bBN),
    `${aBN.toString()} is not less than or equal to ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that two objects or arrays which contain nested BN.js instances are equal.
 *  @param actual What you received
 *  @param expected The shape you expected
 */
export const assertDeepEqual = (
  actual: any,
  expected: any,
  context?: string
) => {
  // Check if it's a value type we can assert on straight away.
  if (BN.isBN(actual) || BN.isBN(expected)) {
    assertBNEqual(actual, expected, context);
  } else if (
    typeof expected === "string" ||
    typeof actual === "string" ||
    typeof expected === "number" ||
    typeof actual === "number" ||
    typeof expected === "boolean" ||
    typeof actual === "boolean"
  ) {
    assert.strictEqual(actual, expected, context);
  }
  // Otherwise dig through the deeper object and recurse
  else if (Array.isArray(expected)) {
    for (let i = 0; i < expected.length; i++) {
      assertDeepEqual(actual[i], expected[i], `(array index: ${i}) `);
    }
  } else {
    for (const key of Object.keys(expected)) {
      assertDeepEqual(actual[key], expected[key], `(key: ${key}) `);
    }
  }
};

/**
 *  Convenience method to assert that an amount of ether (or other 10^18 number) was received from a contract.
 *  @param actualWei The value retrieved from a smart contract or wallet in wei
 *  @param expectedAmount The amount you expect e.g. '1'
 *  @param expectedUnit The unit you expect e.g. 'gwei'. Defaults to 'ether'
 */
export const assertUnitEqual = (
  actualWei: BN,
  expectedAmount: BN,
  expectedUnit: any = "ether"
) => {
  assertBNEqual(actualWei, toWei(expectedAmount, expectedUnit));
};

/**
 *  Convenience method to assert that an amount of ether (or other 10^18 number) was NOT received from a contract.
 *  @param actualWei The value retrieved from a smart contract or wallet in wei
 *  @param expectedAmount The amount you expect NOT to be equal to e.g. '1'
 *  @param expectedUnit The unit you expect e.g. 'gwei'. Defaults to 'ether'
 */
export const assertUnitNotEqual = (
  actualWei: BN,
  expectedAmount: BN,
  expectedUnit: any = "ether"
) => {
  assertBNNotEqual(actualWei, toWei(expectedAmount, expectedUnit));
};

/**
 * Convenience method to assert that the return of the given block when invoked or promise causes a
 * revert to occur, with an optional revert message.
 * @param blockOrPromise The JS block (i.e. function that when invoked returns a promise) or a promise itself
 * @param reason Optional reason string to search for in revert message
 */
export const assertRevert = async (blockOrPromise: any, reason?: string) => {
  let errorCaught = false;
  try {
    const result =
      typeof blockOrPromise === "function" ? blockOrPromise() : blockOrPromise;
    await result;
  } catch (error: any) {
    assert.include(error.message, "revert");
    if (reason) {
      assert.include(error.message, reason);
    }
    errorCaught = true;
  }

  assert.strictEqual(errorCaught, true, "Operation did not revert as expected");
};

export const assertInvalidOpcode = async (blockOrPromise: any) => {
  let errorCaught = false;
  try {
    const result =
      typeof blockOrPromise === "function" ? blockOrPromise() : blockOrPromise;
    await result;
  } catch (error: any) {
    assert.include(error.message, "invalid opcode");
    errorCaught = true;
  }

  assert.strictEqual(
    errorCaught,
    true,
    "Operation did not cause an invalid opcode error as expected"
  );
};
