import * as React from "react"
import { requestHostMicrophonePermission } from "@/lib/desktop-host"
import { DesktopASRClient } from "@/lib/asr-client"
import { PCM16StreamEncoder } from "@/lib/pcm-audio"
import pcmCaptureWorkletURL from "@/worklets/pcm-capture-worklet.ts?worker&url"

import {
  voiceMessageAudioBitsPerSecond,
  voiceMessageContentType,
  voiceMessageMaxBytes,
  voiceMessageMaxDurationMS,
  type VoiceMessageRecording,
} from "@/lib/voice-message"

export type VoiceRecordingStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "transcribing"
  | "recorded"

const analyserFFTSize = 256
const waveformUpdateIntervalMS = 50

export function useVoiceRecording(options: { onTranscript?: (text: string) => void } = {}) {
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const asrClientRef = React.useRef<DesktopASRClient | null>(null)
  const asrCommitRequestedRef = React.useRef(false)
  const asrPendingRef = React.useRef(false)
  const asrReadyRef = React.useRef(false)
  const asrSendChainRef = React.useRef<Promise<void>>(Promise.resolve())
  const asrTranscriptRef = React.useRef("")
  const pendingPCMFramesRef = React.useRef<ArrayBuffer[]>([])
  const pendingRecordingRef = React.useRef<VoiceMessageRecording | null>(null)
  const pcmEncoderRef = React.useRef<PCM16StreamEncoder | null>(null)
  const workletRef = React.useRef<AudioWorkletNode | null>(null)
  const silentGainRef = React.useRef<GainNode | null>(null)
  const stopFallbackRef = React.useRef<number | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const animationFrameRef = React.useRef<number | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const lastWaveformUpdateRef = React.useRef(0)
  const maxDurationTimeoutRef = React.useRef<number | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const recordingStartedAtRef = React.useRef(0)
  const requestVersionRef = React.useRef(0)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)
  const [error, setError] = React.useState("")
  const [level, setLevel] = React.useState(0)
  const [recording, setRecording] = React.useState<VoiceMessageRecording | null>(null)
  const [status, setStatus] = React.useState<VoiceRecordingStatus>("idle")
  const [transcriptionError, setTranscriptionError] = React.useState("")
  const onTranscriptRef = React.useRef(options.onTranscript)

  React.useEffect(() => {
    onTranscriptRef.current = options.onTranscript
  }, [options.onTranscript])

  const clearMaxDurationTimeout = React.useCallback(() => {
    if (maxDurationTimeoutRef.current !== null) {
      window.clearTimeout(maxDurationTimeoutRef.current)
      maxDurationTimeoutRef.current = null
    }
  }, [])

  const releaseMicrophone = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    sourceRef.current?.disconnect()
    if (workletRef.current) workletRef.current.port.onmessage = null
    workletRef.current?.disconnect()
    silentGainRef.current?.disconnect()
    analyserRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    if (audioContextRef.current) {
      void audioContextRef.current.close()
    }

    sourceRef.current = null
    workletRef.current = null
    silentGainRef.current = null
    pcmEncoderRef.current = null
    analyserRef.current = null
    streamRef.current = null
    audioContextRef.current = null
  }, [])

  const closeASR = React.useCallback(() => {
    asrClientRef.current?.close()
    asrClientRef.current = null
    asrPendingRef.current = false
    asrReadyRef.current = false
    asrCommitRequestedRef.current = false
    asrSendChainRef.current = Promise.resolve()
    pendingPCMFramesRef.current = []
    if (stopFallbackRef.current !== null) window.clearTimeout(stopFallbackRef.current)
    stopFallbackRef.current = null
  }, [])

  const publishPendingRecording = React.useCallback(() => {
    const pending = pendingRecordingRef.current
    if (!pending || asrPendingRef.current) return
    pendingRecordingRef.current = null
    setElapsedSeconds(Math.ceil(pending.durationMS / 1_000))
    setLevel(0)
    setRecording(pending)
    setStatus("recorded")
  }, [])

  const discardMediaRecorder = React.useCallback(() => {
    const recorder = mediaRecorderRef.current
    mediaRecorderRef.current = null
    chunksRef.current = []

    if (!recorder) {
      return
    }

    recorder.ondataavailable = null
    recorder.onerror = null
    recorder.onstop = null

    if (recorder.state !== "inactive") {
      recorder.stop()
    }
  }, [])

  function finishRecording() {
    clearMaxDurationTimeout()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") {
      return
    }

    setStatus("processing")
    const worklet = workletRef.current
    if (!worklet) {
      recorder.stop()
      return
    }
    worklet.port.postMessage({ type: "flush" })
    stopFallbackRef.current = window.setTimeout(() => finalizeASRAndStop(recorder), 500)
  }

  function finalizeASRAndStop(recorder: MediaRecorder) {
    if (stopFallbackRef.current !== null) window.clearTimeout(stopFallbackRef.current)
    stopFallbackRef.current = null
    sendPCMFrames(pcmEncoderRef.current?.flush() ?? [])
    asrCommitRequestedRef.current = true
    commitASRIfReady()
    if (recorder.state !== "inactive") recorder.stop()
  }

  function sendPCMFrames(frames: ArrayBuffer[]) {
    if (!asrPendingRef.current || frames.length === 0) return
    if (!asrReadyRef.current || !asrClientRef.current) {
      pendingPCMFramesRef.current.push(...frames)
      return
    }
    const client = asrClientRef.current
    enqueueASROperation(client, async () => {
      for (const frame of frames) await client.sendAudio(frame)
    })
  }

  function commitASRIfReady() {
    const client = asrClientRef.current
    if (
      !asrPendingRef.current ||
      !asrReadyRef.current ||
      !asrCommitRequestedRef.current ||
      !client
    ) {
      return
    }
    asrCommitRequestedRef.current = false
    enqueueASROperation(client, () => client.commit())
  }

  function enqueueASROperation(client: DesktopASRClient, operation: () => Promise<void>) {
    asrSendChainRef.current = asrSendChainRef.current
      .then(() => {
        if (asrClientRef.current !== client || !asrPendingRef.current) return
        return operation()
      })
      .catch((error: unknown) => failASR(error))
  }

  function failASR(error: unknown) {
    setTranscriptionError(error instanceof Error ? error.message : "实时语音识别不可用")
    closeASR()
    publishPendingRecording()
  }

  React.useEffect(() => {
    if (status !== "recording") {
      return
    }

    const interval = window.setInterval(() => {
      const audioTime = audioContextRef.current?.currentTime ?? 0
      const elapsedMS = (audioTime - recordingStartedAtRef.current) * 1_000
      setElapsedSeconds(Math.min(60, Math.max(0, Math.floor(elapsedMS / 1_000))))
    }, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [status])

  React.useEffect(
    () => () => {
      requestVersionRef.current += 1
      clearMaxDurationTimeout()
      discardMediaRecorder()
      releaseMicrophone()
      closeASR()
    },
    [clearMaxDurationTimeout, closeASR, discardMediaRecorder, releaseMicrophone],
  )

  async function startRecording() {
    if (
      status === "requesting" ||
      status === "recording" ||
      status === "processing" ||
      status === "transcribing"
    ) {
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    clearMaxDurationTimeout()
    discardMediaRecorder()
    releaseMicrophone()
    closeASR()
    pendingRecordingRef.current = null
    asrTranscriptRef.current = ""
    setElapsedSeconds(0)
    setError("")
    setLevel(0)
    setRecording(null)
    setTranscriptionError("")
    setStatus("requesting")

    if (!window.isSecureContext) {
      setError("麦克风只能在 HTTPS 或 localhost 下使用")
      setStatus("idle")
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风访问")
      setStatus("idle")
      return
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported(voiceMessageContentType)
    ) {
      setError("当前浏览器不支持 WebM/Opus 录音")
      setStatus("idle")
      return
    }

    try {
      const hostPermission = requestHostMicrophonePermission()
      if (hostPermission && !(await hostPermission)) {
        throw new DOMException("microphone permission denied", "NotAllowedError")
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      if (requestVersionRef.current !== requestVersion) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: voiceMessageAudioBitsPerSecond,
        mimeType: voiceMessageContentType,
      })

      analyser.fftSize = analyserFFTSize
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)

      streamRef.current = stream
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        if (requestVersionRef.current !== requestVersion) {
          return
        }

        requestVersionRef.current += 1
        clearMaxDurationTimeout()
        discardMediaRecorder()
        releaseMicrophone()
        closeASR()
        setError("录音失败，请重新尝试")
        setLevel(0)
        setStatus("idle")
      }
      recorder.onstop = () => {
        const durationMS = Math.min(
          voiceMessageMaxDurationMS,
          Math.max(
            1,
            Math.round((audioContext.currentTime - recordingStartedAtRef.current) * 1_000),
          ),
        )
        const blob = new Blob(chunksRef.current, {
          type: voiceMessageContentType,
        })

        mediaRecorderRef.current = null
        chunksRef.current = []
        releaseMicrophone()

        if (requestVersionRef.current !== requestVersion) {
          return
        }
        if (blob.size <= 0) {
          setError("没有录制到有效的语音内容")
          setStatus("idle")
          return
        }
        if (blob.size > voiceMessageMaxBytes) {
          setError("语音文件超过 1MiB，请重新录制")
          setStatus("idle")
          return
        }

        pendingRecordingRef.current = {
          blob,
          durationMS,
          transcript: asrTranscriptRef.current.trim() || undefined,
        }
        if (asrPendingRef.current) {
          setStatus("transcribing")
          stopFallbackRef.current = window.setTimeout(() => {
            setTranscriptionError("语音识别结束超时，仍可发送语音")
            closeASR()
            publishPendingRecording()
          }, 5_000)
        } else {
          publishPendingRecording()
        }
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume()
      }
      if (requestVersionRef.current !== requestVersion) {
        discardMediaRecorder()
        releaseMicrophone()
        return
      }

      try {
        await audioContext.audioWorklet.addModule(pcmCaptureWorkletURL)
        if (requestVersionRef.current !== requestVersion) {
          discardMediaRecorder()
          releaseMicrophone()
          return
        }

        const encoder = new PCM16StreamEncoder(audioContext.sampleRate)
        const worklet = new AudioWorkletNode(audioContext, "pcm-capture")
        const silentGain = audioContext.createGain()
        silentGain.gain.value = 0
        worklet.port.onmessage = (event: MessageEvent<unknown>) => {
          if (requestVersionRef.current !== requestVersion) return
          const value = event.data
          if (!value || typeof value !== "object") return
          const message = value as { samples?: unknown; type?: unknown }
          if (message.type === "samples" && message.samples instanceof Float32Array) {
            sendPCMFrames(encoder.push(message.samples))
          } else if (message.type === "flushed") {
            finalizeASRAndStop(recorder)
          }
        }
        source.connect(worklet)
        worklet.connect(silentGain)
        silentGain.connect(audioContext.destination)
        pcmEncoderRef.current = encoder
        workletRef.current = worklet
        silentGainRef.current = silentGain

        const asrClient = new DesktopASRClient({
          onCompleted(text) {
            if (requestVersionRef.current !== requestVersion || asrClientRef.current !== asrClient)
              return
            asrTranscriptRef.current = text.trim()
            onTranscriptRef.current?.(text)
            asrPendingRef.current = false
            asrReadyRef.current = false
            if (pendingRecordingRef.current) {
              pendingRecordingRef.current = {
                ...pendingRecordingRef.current,
                transcript: asrTranscriptRef.current || undefined,
              }
            }
            publishPendingRecording()
          },
          onError(message) {
            if (requestVersionRef.current === requestVersion) failASR(new Error(message))
          },
          onTranscript(text) {
            if (requestVersionRef.current !== requestVersion || asrClientRef.current !== asrClient)
              return
            asrTranscriptRef.current = text
            onTranscriptRef.current?.(text)
          },
        })
        asrClientRef.current = asrClient
        asrPendingRef.current = true
        void asrClient
          .connect()
          .then(() => {
            if (
              requestVersionRef.current !== requestVersion ||
              asrClientRef.current !== asrClient
            ) {
              asrClient.close()
              return
            }
            asrReadyRef.current = true
            const pendingFrames = pendingPCMFramesRef.current
            pendingPCMFramesRef.current = []
            sendPCMFrames(pendingFrames)
            commitASRIfReady()
          })
          .catch((error: unknown) => {
            if (requestVersionRef.current === requestVersion) failASR(error)
          })
      } catch (caughtError) {
        setTranscriptionError(
          caughtError instanceof Error ? caughtError.message : "实时语音识别不可用",
        )
      }

      recordingStartedAtRef.current = audioContext.currentTime
      recorder.start(250)
      workletRef.current?.port.postMessage({ type: "start" })
      setStatus("recording")
      monitorMicrophoneLevel(analyser)
      maxDurationTimeoutRef.current = window.setTimeout(finishRecording, voiceMessageMaxDurationMS)
    } catch (caughtError) {
      if (requestVersionRef.current !== requestVersion) {
        return
      }

      clearMaxDurationTimeout()
      discardMediaRecorder()
      releaseMicrophone()
      closeASR()
      setError(getMicrophoneErrorMessage(caughtError))
      setStatus("idle")
    }
  }

  function monitorMicrophoneLevel(analyser: AnalyserNode) {
    const samples = new Uint8Array(analyser.fftSize)

    function update(timestamp: number) {
      if (analyserRef.current !== analyser) {
        return
      }

      if (timestamp - lastWaveformUpdateRef.current >= waveformUpdateIntervalMS) {
        analyser.getByteTimeDomainData(samples)
        let sumOfSquares = 0

        for (const sample of samples) {
          const normalizedSample = (sample - 128) / 128
          sumOfSquares += normalizedSample * normalizedSample
        }

        const rootMeanSquare = Math.sqrt(sumOfSquares / samples.length)
        setLevel(Math.min(1, Math.max(0, rootMeanSquare * 8)))
        lastWaveformUpdateRef.current = timestamp
      }

      animationFrameRef.current = window.requestAnimationFrame(update)
    }

    animationFrameRef.current = window.requestAnimationFrame(update)
  }

  function resetRecording() {
    requestVersionRef.current += 1
    clearMaxDurationTimeout()
    discardMediaRecorder()
    releaseMicrophone()
    closeASR()
    pendingRecordingRef.current = null
    asrTranscriptRef.current = ""
    setElapsedSeconds(0)
    setError("")
    setLevel(0)
    setRecording(null)
    setTranscriptionError("")
    setStatus("idle")
  }

  return {
    elapsedSeconds,
    error,
    level,
    recording,
    resetRecording,
    startRecording,
    status,
    stopRecording: finishRecording,
    transcriptionError,
  }
}

function getMicrophoneErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "无法访问麦克风，请稍后重试"
  }

  switch (error.name) {
    case "NotAllowedError":
      return "未获得麦克风权限，请在系统或浏览器设置中允许访问"
    case "NotFoundError":
      return "没有检测到可用的麦克风"
    case "NotReadableError":
      return "麦克风暂时不可用，可能正在被其他应用占用"
    default:
      return "无法访问麦克风，请稍后重试"
  }
}
