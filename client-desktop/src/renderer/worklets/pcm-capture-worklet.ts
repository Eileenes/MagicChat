declare const sampleRate: number

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  abstract process(inputs: Float32Array[][]): boolean
}

declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

type WorkletControlMessage = Readonly<{
  type?: "flush" | "start"
}>

class PCMCaptureProcessor extends AudioWorkletProcessor {
  private active = false
  private samples: number[] = []
  private readonly targetSamples = Math.max(128, Math.round(sampleRate / 10))

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<WorkletControlMessage>) => {
      if (event.data.type === "start") {
        this.active = true
      } else if (event.data.type === "flush") {
        this.active = false
        this.flush()
        this.port.postMessage({ type: "flushed" })
      }
    }
  }

  process(inputs: Float32Array[][]) {
    if (!this.active) return true
    const channels = inputs[0]
    if (!channels?.length) return true

    const length = channels[0]?.length ?? 0
    for (let index = 0; index < length; index += 1) {
      let sample = 0
      for (const channel of channels) sample += channel[index] ?? 0
      this.samples.push(sample / channels.length)
    }
    if (this.samples.length >= this.targetSamples) this.flush()
    return true
  }

  private flush() {
    if (this.samples.length === 0) return
    const samples = new Float32Array(this.samples)
    this.samples = []
    this.port.postMessage({ samples, type: "samples" }, [samples.buffer])
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor)
