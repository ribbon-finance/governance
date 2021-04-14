const { artifacts, web3 } = require("hardhat");

const { assert } = require("./common");

module.exports = {
  timeIsClose({ actual, expected, variance = 1 }) {
    assert.ok(
      Math.abs(Number(actual) - Number(expected)) <= variance,
      `Time is not within variance of ${variance}. Actual: ${Number(
        actual
      )}, Expected: ${expected}`
    );
  },

  async onlyGivenAddressCanInvoke({
    fnc,
    args,
    accounts,
    address = undefined,
    skipPassCheck = false,
    reason = undefined,
  }) {
    for (const user of accounts) {
      if (user === address) {
        continue;
      }

      await assert.revert(fnc(...args, { from: user }), reason);
    }
    if (!skipPassCheck && address) {
      await fnc(...args, { from: address });
    }
  },

  ensureOnlyExpectedMutativeFunctions({
    abi,
    hasFallback = false,
    expected = [],
    ignoreParents = [],
  }) {
    const removeExcessParams = (abiEntry) => {
      // Clone to not mutate anything processed by truffle
      const clone = JSON.parse(JSON.stringify(abiEntry));
      // remove the signature in the cases where it's in the parent ABI but not the subclass
      delete clone.signature;
      // remove input and output named params
      (clone.inputs || []).map((input) => {
        delete input.name;
        return input;
      });
      (clone.outputs || []).map((input) => {
        delete input.name;
        return input;
      });
      return clone;
    };

    const combinedParentsABI = ignoreParents
      .reduce((memo, parent) => memo.concat(artifacts.require(parent).abi), [])
      .map(removeExcessParams);

    const fncs = abi
      .filter(
        ({ type, stateMutability }) =>
          type === "function" &&
          stateMutability !== "view" &&
          stateMutability !== "pure"
      )
      .map(removeExcessParams)
      .filter(
        (entry) =>
          !combinedParentsABI.find(
            (parentABIEntry) =>
              JSON.stringify(parentABIEntry) === JSON.stringify(entry)
          )
      )
      .map(({ name }) => name);

    assert.bnEqual(
      fncs.sort(),
      expected.sort(),
      "Mutative functions should only be those expected."
    );

    const fallbackFnc = abi.filter(
      ({ type, stateMutability }) => type === "fallback"
    );

    assert.equal(
      fallbackFnc.length > 0,
      hasFallback,
      hasFallback
        ? "No fallback function found"
        : "Fallback function found when not expected"
    );
  },
};
