import { describe, expect, it } from "vitest"

import { parseExternalWebLink } from "@shared/external-link"

describe("外部网页链接校验", () => {
  it.each(["http://intranet.example.test:8080/docs", "https://example.com/docs"])(
    "允许 HTTP 和 HTTPS 链接：%s",
    (url) => {
      expect(parseExternalWebLink(url)).toMatchObject({ url })
    },
  )

  it.each(["file:///tmp/report", "javascript:alert(1)", "mailto:user@example.com", "not-a-url"])(
    "拒绝非网页链接：%s",
    (url) => {
      expect(parseExternalWebLink(url)).toBeUndefined()
    },
  )
})
