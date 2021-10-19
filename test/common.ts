import { assert as chaiAssert } from "chai";

import {
  assertEventEqual,
  assertEventsEqual,
  assertBNEqual,
  assertBNNotEqual,
  assertBNClose,
  assertBNGreaterEqualThan,
  assertBNGreaterThan,
  assertBNLessEqualThan,
  assertBNLessThan,
  assertDeepEqual,
  assertInvalidOpcode,
  assertUnitEqual,
  assertUnitNotEqual,
  assertRevert,
  takeSnapshot,
  restoreSnapshot,
} from "./utils";

let lastSnapshotId: string;

// So we don't have to constantly import our assert helpers everywhere
// we'll just tag them onto the assert object for easy access.
export const assert = Object.assign({}, chaiAssert, {
  eventEqual: assertEventEqual,
  eventsEqual: assertEventsEqual,
  bnEqual: assertBNEqual,
  bnNotEqual: assertBNNotEqual,
  bnClose: assertBNClose,
  bnGte: assertBNGreaterEqualThan,
  bnLte: assertBNLessEqualThan,
  bnLt: assertBNLessThan,
  bnGt: assertBNGreaterThan,
  deepEqual: assertDeepEqual,
  etherEqual: assertUnitEqual,
  etherNotEqual: assertUnitNotEqual,
  invalidOpcode: assertInvalidOpcode,
  unitEqual: assertUnitEqual,
  unitNotEqual: assertUnitNotEqual,
  revert: assertRevert,
});

// And this is our test sandboxing. It snapshots and restores between each test.
// Note: if a test suite uses fastForward at all, then it MUST also use these snapshots,
// otherwise it will update the block time of the EVM and future tests that expect a
// starting timestamp will fail.
export const addSnapshotBeforeRestoreAfterEach = () => {
  beforeEach(async () => {
    lastSnapshotId = await takeSnapshot();
  });

  afterEach(async () => {
    await restoreSnapshot(lastSnapshotId);
  });
};

export const addSnapshotBeforeRestoreAfter = () => {
  before(async () => {
    lastSnapshotId = await takeSnapshot();
  });

  after(async () => {
    await restoreSnapshot(lastSnapshotId);
  });
};
