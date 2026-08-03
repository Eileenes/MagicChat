import assert from "node:assert/strict"
import test from "node:test"

import { assertAllowedOrigin, cookieValue } from "./http-security.js"

test("cookieValue reads the exact cookie name", () => {
  assert.equal(cookieValue("other=x; user_session=secret%2Bvalue", "user_session"), "secret+value")
  assert.equal(cookieValue("other_user_session=x", "user_session"), null)
})

test("assertAllowedOrigin permits an explicit origin", () => {
  assert.doesNotThrow(() =>
    assertAllowedOrigin(
      { origin: "https://docs.example.com" },
      new Set(["https://docs.example.com"])
    )
  )
})

test("assertAllowedOrigin defaults to same-host requests", () => {
  assert.doesNotThrow(() =>
    assertAllowedOrigin(
      {
        host: "document-server:20100",
        origin: "https://app.example.com",
        "x-forwarded-host": "app.example.com",
      },
      new Set()
    )
  )
})

test("assertAllowedOrigin rejects a foreign origin", () => {
  assert.throws(() =>
    assertAllowedOrigin(
      { host: "app.example.com", origin: "https://attacker.example" },
      new Set()
    )
  )
})
