import assert from "node:assert/strict"
import test from "node:test"

import { PersistenceRetry, withTimeout } from "./persistence-retry.js"

test("PersistenceRetry reports degradation and recovers after a successful write", async () => {
  let attempts = 0
  let observedRetry = () => undefined
  const retryObserved = new Promise<void>((resolve) => {
    observedRetry = resolve
  })
  const retry = new PersistenceRetry({
    initialDelayMs: 1,
    maximumDelayMs: 2,
    onRetry: () => observedRetry(),
  })

  const running = retry.run(async () => {
    attempts += 1
    if (attempts < 3) throw new Error("database unavailable")
  })
  await retryObserved
  assert.equal(retry.healthy, false)

  await running
  assert.equal(attempts, 3)
  assert.equal(retry.healthy, true)
})

test("PersistenceRetry can abort a pending retry", async () => {
  const retry = new PersistenceRetry({ initialDelayMs: 10_000, maximumDelayMs: 10_000 })
  const running = retry.run(async () => {
    throw new Error("database unavailable")
  })
  retry.stop()

  await assert.rejects(running)
  assert.equal(retry.healthy, true)
})

test("withTimeout rejects an operation that does not finish", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 1, "shutdown timed out"),
    /shutdown timed out/
  )
})
