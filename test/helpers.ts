const { artifacts, web3 } = require("hardhat");

const { assert } = require("./common");

export const timeIsClose = ({
  actual,
  expected,
  variance = 1,
}: {
  actual: any;
  expected: any;
  variance?: number;
}) => {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= variance,
    `Time is not within variance of ${variance}. Actual: ${Number(
      actual
    )}, Expected: ${expected}`
  );
};

export const ensureOnlyExpectedMutativeFunctions = ({
  abi,
  hasFallback = false,
  expected = [],
  ignoreParents = [],
}: {
  abi: any;
  hasFallback?: boolean;
  expected: string[];
  ignoreParents: string[];
}) => {
  const removeExcessParams = (abiEntry: any) => {
    // Clone to not mutate anything processed by truffle
    const clone = JSON.parse(JSON.stringify(abiEntry));
    // remove the signature in the cases where it's in the parent ABI but not the subclass
    delete clone.signature;
    // remove input and output named params
    (clone.inputs || []).map((input: any) => {
      delete input.name;
      return input;
    });
    (clone.outputs || []).map((input: any) => {
      delete input.name;
      return input;
    });
    return clone;
  };

  const combinedParentsABI = ignoreParents
    .reduce(
      (memo: any, parent: any) => memo.concat(artifacts.require(parent).abi),
      []
    )
    .map(removeExcessParams);

  const fncs = abi
    .filter(
      ({ type, stateMutability }: { type: any; stateMutability: any }) =>
        type === "function" &&
        stateMutability !== "view" &&
        stateMutability !== "pure"
    )
    .map(removeExcessParams)
    .filter(
      (entry: string) =>
        !combinedParentsABI.find(
          (parentABIEntry: any) =>
            JSON.stringify(parentABIEntry) === JSON.stringify(entry)
        )
    )
    .map(({ name }: { name: string }) => name);

  assert.bnEqual(
    fncs.sort(),
    expected.sort(),
    "Mutative functions should only be those expected."
  );

  const fallbackFnc = abi.filter(
    ({ type, stateMutability }: { type: any; stateMutability: any }) =>
      type === "fallback"
  );

  assert.equal(
    fallbackFnc.length > 0,
    hasFallback,
    hasFallback
      ? "No fallback function found"
      : "Fallback function found when not expected"
  );
};
