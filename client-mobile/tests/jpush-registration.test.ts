import assert from "node:assert/strict"
import test from "node:test"

import { normalizeJPushNotificationResponse } from "@/notifications/jpush-notification-response"

test("normalizes only fixed-template JPush notification responses", () => {
  assert.deepEqual(
    normalizeJPushNotificationResponse({
      date: 1_787_814_400_000,
      event: "message.created",
      grantId: "grant-1",
      identifier: "jpush-message-1",
      routeToken: "r".repeat(43),
    }),
    {
      data: {
        event: "message.created",
        grant_id: "grant-1",
        route_token: "r".repeat(43),
      },
      date: 1_787_814_400_000,
      identifier: "jpush-message-1",
    }
  )
  assert.equal(
    normalizeJPushNotificationResponse({
      date: Date.now(),
      event: "other",
      grantId: "grant-1",
      routeToken: "r".repeat(43),
    }),
    null
  )
  assert.equal(
    normalizeJPushNotificationResponse({
      date: Date.now(),
      event: "message.created",
      grantId: "grant-1",
      routeToken: "short",
    }),
    null
  )
})
