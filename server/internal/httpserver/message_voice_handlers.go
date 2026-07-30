package httpserver

import "strings"

const (
	maxVoiceMessageDurationMS  = 60_000
	maxVoiceMessageUploadBytes = 1 * 1024 * 1024
	messageTypeVoice           = "voice"
	voiceMessageMP4ContentType = "audio/mp4"
	voiceMessageContentType    = "audio/webm"
)

var webMHeader = []byte{0x1a, 0x45, 0xdf, 0xa3}

type voiceMessageBody struct {
	Type        string `json:"type"`
	FileID      string `json:"file_id"`
	DurationMS  int    `json:"duration_ms"`
	SizeBytes   int64  `json:"size_bytes"`
	ContentType string `json:"content_type"`
	Transcript  string `json:"transcript"`
}

func voiceMessageSummary(_ int, transcript string) string {
	transcript = strings.TrimSpace(transcript)
	if transcript == "" {
		return "[语音]"
	}
	return "[语音] " + transcript
}
