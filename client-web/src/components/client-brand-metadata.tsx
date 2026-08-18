import { useEffect } from "react"

import { useAppInfo } from "@/lib/app-info-context"

export function ClientBrandMetadata() {
  const { appName } = useAppInfo()

  useEffect(() => {
    setMetaContent('meta[name="application-name"]', appName)
    setMetaContent('meta[property="og:site_name"]', appName)
    setMetaContent('meta[property="og:title"]', `${appName} AI时代的团队协作入口`)
    setMetaContent('meta[name="twitter:title"]', `${appName} AI时代的团队协作入口`)
    setMetaContent(
      'meta[name="description"]',
      "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。",
    )
    setMetaContent(
      'meta[property="og:description"]',
      "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。",
    )
    setMetaContent(
      'meta[name="twitter:description"]',
      "即应是一款开源的即时通讯工具，连接消息、知识与任务，让 Agent 深度融入工作流，成为真正能参与协作、推动执行的数字员工。",
    )
    setMetaContent(
      'meta[name="keywords"]',
      `${appName},AI 企业 IM,企业即时通讯,AI 助手,团队协作,企业聊天,项目管理,任务管理`
    )
  }, [appName])

  return null
}

function setMetaContent(selector: string, content: string) {
  document
    .querySelector<HTMLMetaElement>(selector)
    ?.setAttribute("content", content)
}
