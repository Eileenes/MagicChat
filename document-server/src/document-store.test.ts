import assert from "node:assert/strict"
import test from "node:test"

import * as Y from "yjs"

import { createInitialState, normalizeTitle } from "./document-store.js"

test("createInitialState seeds the stable Y.Doc schema", () => {
  const document = new Y.Doc()
  Y.applyUpdate(document, createInitialState("产品需求文档"))

  assert.equal(document.getText("title").toString(), "产品需求文档")
  assert.equal(document.getXmlFragment("body").length, 0)
})

test("normalizeTitle supplies the visible empty title", () => {
  assert.equal(normalizeTitle(" \0 "), "无标题文档")
})

test("normalizeTitle limits Unicode characters without splitting surrogate pairs", () => {
  const title = "😀".repeat(501)
  assert.equal(Array.from(normalizeTitle(title)).length, 500)
  assert.ok(normalizeTitle(title).endsWith("😀"))
})
