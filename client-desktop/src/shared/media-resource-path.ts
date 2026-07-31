export function isAllowedDesktopMediaPath(pathname: string): boolean {
  return pathname.startsWith("/api/client/") || isTrustedServerStaticResource(pathname)
}

export function isTrustedServerStaticResource(pathname: string): boolean {
  return (
    /^\/assets\/avatars\/builtin\/(?:0[1-9]|[1-5][0-9]|6[0-4])\.webp$/.test(pathname) ||
    pathname === "/assets/apps/assistant.webp"
  )
}
