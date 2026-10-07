/**
 * Jest stub for @op-engineering/op-sqlite (Stage 5).
 *
 * The native module has no Node harness (its entry point does not even
 * load outside a device build), so screens mount against an empty
 * in-memory stand-in: every query returns no rows. Repository semantics
 * stay unit-tested through FakeDatabase in src/data/testing/.
 */

function open() {
  return {
    execute: async () => ({ rows: [], rowsAffected: 0 }),
    close: () => {},
  };
}

module.exports = {
  open,
};
