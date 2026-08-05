import assert from "node:assert/strict"
import test from "node:test"

import { scheduleAuthorizationRecheck } from "./auth-recheck.js"
import type { DocumentConnectionContext } from "./auth.js"

const context: DocumentConnectionContext = {
  documentId: "550e8400-e29b-41d4-a716-446655440000",
  sessionId: "session-id",
  userAvatar: "/avatar.png",
  userId: "user-id",
  userName: "林晓",
}

test("authorization recheck closes a connection after access is revoked", async () => {
  let onClose = () => undefined
  const closeEvent = await new Promise<{ code: number; reason: string }>(
    (resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("authorization recheck did not run")),
        500
      )
      scheduleAuthorizationRecheck(
        { reauthorize: async () => Promise.reject(new Error("revoked")) },
        {
          close: (event) => {
            clearTimeout(timeout)
            resolve(event)
          },
          onClose: (callback) => {
            onClose = callback
          },
        },
        context,
        1
      )
    }
  )

  onClose()
  assert.deepEqual(closeEvent, { code: 4403, reason: "permission-denied" })
})

test("authorization recheck does not overlap slow checks", async () => {
  let active = 0
  let maximumActive = 0
  let finishCheck = () => undefined
  let onClose = () => undefined
  const checkStarted = new Promise<void>((resolve) => {
    scheduleAuthorizationRecheck(
      {
        reauthorize: async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          resolve()
          await new Promise<void>((finish) => {
            finishCheck = finish
          })
          active -= 1
        },
      },
      {
        close: () => assert.fail("connection should stay open"),
        onClose: (callback) => {
          onClose = callback
        },
      },
      context,
      1
    )
  })

  await checkStarted
  await new Promise((resolve) => setTimeout(resolve, 10))
  onClose()
  finishCheck()
  assert.equal(maximumActive, 1)
})
