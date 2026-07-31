import assert from "node:assert/strict"
import test from "node:test"

import { SharedTaskPool } from "../src/data/resources/shared-task-pool.ts"

test("one caller can abort without cancelling a shared task", async () => {
  const pool = new SharedTaskPool<string>()
  const deferred = createDeferred<string>()
  const firstController = new AbortController()
  let operationCount = 0
  const operation = () => {
    operationCount += 1
    return deferred.promise
  }

  const first = pool.run("resource", operation, firstController.signal)
  const second = pool.run("resource", operation)
  firstController.abort()

  await assert.rejects(first, (error: unknown) => isAbortError(error))
  deferred.resolve("cached-resource")
  assert.equal(await second, "cached-resource")
  assert.equal(operationCount, 1)
})

test("does not start a task for an already aborted caller", async () => {
  const pool = new SharedTaskPool<string>()
  const controller = new AbortController()
  controller.abort()
  let operationCount = 0

  await assert.rejects(
    pool.run(
      "resource",
      async () => {
        operationCount += 1
        return "unused"
      },
      controller.signal
    ),
    (error: unknown) => isAbortError(error)
  )
  assert.equal(operationCount, 0)
})

test("evicts failed tasks so a later caller can retry", async () => {
  const pool = new SharedTaskPool<string>()
  let operationCount = 0
  const operation = async () => {
    operationCount += 1
    if (operationCount === 1) throw new Error("download failed")
    return "retried-resource"
  }

  await assert.rejects(pool.run("resource", operation), /download failed/)
  assert.equal(await pool.run("resource", operation), "retried-resource")
  assert.equal(operationCount, 2)
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}
