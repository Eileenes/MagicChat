export type ExternalWebLink = Readonly<{
  hostname: string
  protocol: "http:" | "https:"
  url: string
}>

export function parseExternalWebLink(value: string): ExternalWebLink | undefined {
  if (!value || value.length > 4096 || /[\u0000]/.test(value)) return undefined

  try {
    const url = new URL(value)
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return undefined
    }

    return {
      hostname: url.hostname,
      protocol: url.protocol,
      url: url.toString(),
    }
  } catch {
    return undefined
  }
}
