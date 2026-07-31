import { describe, expect, it } from "vitest"
import { PCM16StreamEncoder } from "./pcm-audio"

describe("PCM16StreamEncoder", () => {
  it("将 48kHz 重采样为 16kHz 的 200ms PCM16 帧", () => {
    const encoder = new PCM16StreamEncoder(48_000)
    const frames = encoder.push(new Float32Array(9_600).fill(0.25))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.byteLength).toBe(6_400)
  })

  it("clamp 有符号样本并以小端序 flush", () => {
    const encoder = new PCM16StreamEncoder(16_000)
    encoder.push(new Float32Array([-2, 0, 2, 0]))
    const [frame] = encoder.flush()
    const view = new DataView(frame!)
    expect(view.getInt16(0, true)).toBe(-32_768)
    expect(view.getInt16(4, true)).toBe(32_767)
  })

  it("拒绝低于目标的采样率", () => {
    expect(() => new PCM16StreamEncoder(8_000)).toThrow("音频采样率不支持")
  })
})
