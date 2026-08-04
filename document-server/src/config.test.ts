import assert from "node:assert/strict"
import test from "node:test"

import { loadConfig } from "./config.js"

test("loadConfig builds an encoded PostgreSQL URL", () => {
  const config = loadConfig({
    POSTGRES_DB: "magic chat",
    POSTGRES_HOST: "postgres.internal",
    POSTGRES_PASSWORD: "p@ss:word",
    POSTGRES_PORT: "5544",
    POSTGRES_USER: "magic-chat",
  })
  assert.equal(
    config.databaseURL,
    "postgres://magic-chat:p%40ss%3Aword@postgres.internal:5544/magic%20chat"
  )
})

test("loadConfig rejects an invalid debounce range", () => {
  assert.throws(
    () =>
      loadConfig({
        DOCUMENT_STORE_DEBOUNCE_MS: "5000",
        DOCUMENT_STORE_MAX_DEBOUNCE_MS: "1000",
      }),
    /must be greater than or equal/
  )
})

test("DATABASE_URL takes precedence", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://example/documents" })
  assert.equal(config.databaseURL, "postgres://example/documents")
})
