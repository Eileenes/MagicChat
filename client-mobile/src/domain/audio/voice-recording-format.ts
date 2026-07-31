export type VoiceRecordingFormat = {
  extension: ".m4a" | ".webm"
  mimeType: "audio/mp4" | "audio/webm"
}

export function getVoiceRecordingFormat(platformOS: string): VoiceRecordingFormat {
  return platformOS === "ios"
    ? { extension: ".m4a", mimeType: "audio/mp4" }
    : { extension: ".webm", mimeType: "audio/webm" }
}
