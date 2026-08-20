import { readdir } from "node:fs/promises"
import path from "node:path"
import { session, type Session } from "electron"
import type { ServerProfile } from "@shared/bridge"

export class SessionController {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly userDataPath: string) {}

  for(profile: ServerProfile): Session {
    const existing = this.sessions.get(profile.id)
    if (existing) return existing
    const partition = `persist:magicchat-server-${profile.id.replace(/[^a-zA-Z0-9-]/g, "")}`
    const value = session.fromPartition(partition, { cache: true })
    value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    value.setPermissionCheckHandler(() => false)
    value.setCertificateVerifyProc((_request, callback) => callback(-3))
    this.sessions.set(profile.id, value)
    return value
  }

  async remove(profile: ServerProfile): Promise<void> {
    const value = this.for(profile)
    await Promise.all([value.clearStorageData(), value.clearCache()])
    value.flushStorageData()
    this.sessions.delete(profile.id)
  }

  async clearNetworkCaches(): Promise<void> {
    await Promise.all((await this.storageSessions()).map((value) => value.clearCache()))
  }

  async clearRuntimeCaches(): Promise<void> {
    await Promise.all(
      (await this.storageSessions()).flatMap((value) => [
        value.clearCodeCaches({}),
        value.clearSharedDictionaryCache(),
        value.clearStorageData({ storages: ["shadercache"] }),
      ]),
    )
  }

  private async storageSessions(): Promise<ReadonlyArray<Session>> {
    const values = new Set<Session>([session.defaultSession, ...this.sessions.values()])
    const partitionsPath = path.join(this.userDataPath, "Partitions")
    const entries = await readdir(partitionsPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^magicchat-server-[a-zA-Z0-9-]+$/.test(entry.name)) continue
      values.add(session.fromPartition(`persist:${entry.name}`, { cache: true }))
    }
    return [...values]
  }
}
