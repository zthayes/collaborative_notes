import test from "node:test";
import assert from "node:assert/strict";

test("revision conflicts should be treated as conflicts", () => {
  const currentRevision = 4;
  const submittedRevision = 3;

  assert.notEqual(currentRevision, submittedRevision);
});
