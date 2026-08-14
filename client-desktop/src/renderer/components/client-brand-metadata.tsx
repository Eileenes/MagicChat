import { useEffect } from "react"

import { useAppInfo } from "@/lib/app-info-context"

export function ClientBrandMetadata() {
  const { appName } = useAppInfo()

  useEffect(() => {
    setMetaContent('meta[name="application-name"]', appName)
    setMetaContent('meta[property="og:site_name"]', appName)
    setMetaContent('meta[property="og:title"]', `有事｜${appName}`)
    setMetaContent('meta[name="twitter:title"]', `有事｜${appName}`)
    setMetaContent('meta[name="description"]', "AI时代下的团队协作入口")
    setMetaContent('meta[property="og:description"]', "AI时代下的团队协作入口")
    setMetaContent('meta[name="twitter:description"]', "AI时代下的团队协作入口")
    setMetaContent(
      'meta[name="keywords"]',
      `${appName},AI 企业 IM,企业即时通讯,AI 助手,团队协作,企业聊天,项目管理,任务管理`,
    )
  }, [appName])

  return null
}

function setMetaContent(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", content)
}
