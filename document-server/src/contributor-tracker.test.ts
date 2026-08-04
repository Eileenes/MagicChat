import assert from "node:assert/strict"
import test from "node:test"

import { ContributorTracker } from "./contributor-tracker.js"

test("ContributorTracker keeps every user in a debounce window", () => {
  const tracker = new ContributorTracker()
  tracker.record("document-1", "user-1")
  tracker.record("document-1", "user-2")
  tracker.record("document-1", "user-1")

  assert.deepEqual(
    new Set(tracker.take("document-1")),
    new Set(["user-1", "user-2"])
  )
  assert.deepEqual(tracker.take("document-1", "user-3"), ["user-3"])
})
