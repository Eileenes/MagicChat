import { render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ClientBrandMetadata } from "@/components/client-brand-metadata"
import { AppInfoContext } from "@/lib/app-info-context"

const originalHead = document.head.innerHTML

describe("ClientBrandMetadata", () => {
  afterEach(() => {
    document.head.innerHTML = originalHead
  })

  it("uses the configured app name in document metadata", async () => {
    document.head.innerHTML = `
      <meta name="application-name" content="即应" />
      <meta name="description" content="" />
      <meta name="keywords" content="" />
      <meta property="og:site_name" content="即应" />
      <meta property="og:title" content="即应 AI时代的团队协作入口" />
      <meta property="og:description" content="" />
      <meta name="twitter:title" content="即应 AI时代的团队协作入口" />
      <meta name="twitter:description" content="" />
    `

    render(
      <AppInfoContext.Provider
        value={{
          appName: "星环协作",
          authenticated: false,
          emailCodeLoginEnabled: false,
          oidcProviders: [],
          organizationName: "长亭科技",
          passwordLoginEnabled: true,
          setAuthenticated: () => undefined,
          thirdPartyProviders: [],
        }}
      >
        <ClientBrandMetadata />
      </AppInfoContext.Provider>
    )

    await waitFor(() => {
      expect(getMetaContent('meta[name="application-name"]')).toBe("星环协作")
      expect(getMetaContent('meta[property="og:site_name"]')).toBe("星环协作")
      expect(getMetaContent('meta[property="og:title"]')).toBe(
        "星环协作 AI时代的团队协作入口",
      )
      expect(getMetaContent('meta[name="twitter:title"]')).toBe(
        "星环协作 AI时代的团队协作入口"
      )
      expect(getMetaContent('meta[name="description"]')).toBe(
        "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。"
      )
      expect(getMetaContent('meta[property="og:description"]')).toBe(
        "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。"
      )
      expect(getMetaContent('meta[name="twitter:description"]')).toBe(
        "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。"
      )
      expect(getMetaContent('meta[name="keywords"]')).toContain("星环协作")
    })
  })
})

function getMetaContent(selector: string) {
  return document.querySelector<HTMLMetaElement>(selector)?.content
}
