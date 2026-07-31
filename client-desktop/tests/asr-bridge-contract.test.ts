// @vitest-environment node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { ASR_LIMITS } from "@shared/asr-contract"
import { IPC } from "@shared/bridge"

const root = path.resolve(import.meta.dirname, "..")

describe("ASR Bridge 安全边界", () => {
  it("Shared、Preload 和 Main 只注册固定五项窄类型操作", async () => {
    const [bridge, preload, mainIpc] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/ipc.ts"), "utf8"),
    ])
    for (const operation of ["Connect", "SendFrame", "Commit", "Close", "Event"]) {
      expect(bridge).toContain(`asr${operation}`)
      expect(preload).toContain(`IPC.asr${operation}`)
      expect(mainIpc).toContain(`IPC.asr${operation}`)
    }
    expect(IPC.asrConnect).toBe("desktop:v1:asr-connect")
    expect(IPC.asrEvent).toBe("desktop:v1:asr-event")
  })

  it("Renderer 不能提交 ASR URL、Header、Cookie 或通用 WebSocket 参数", async () => {
    const [contract, preload] = await Promise.all([
      readFile(path.join(root, "src/shared/asr-contract.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
    ])
    expect(contract).not.toMatch(/url\s*:/i)
    expect(contract).not.toMatch(/headers?\s*:/i)
    expect(contract).not.toMatch(/cookie\s*:/i)
    expect(contract).not.toMatch(/websocket/i)
    expect(preload).not.toContain("ipcRenderer.invoke(channel")
  })

  it("固定单帧、背压、队列和连接超时上限", () => {
    expect(ASR_LIMITS).toEqual({
      backpressureBytes: 256 * 1024,
      connectTimeoutMs: 10_000,
      frameBytes: 256 * 1024,
      maxQueueBytes: 2 * 1024 * 1024,
    })
  })
})
