package message

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

type storedFileMessageBody struct {
	FileID    string `json:"file_id"`
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Type      string `json:"type"`
}

func (s *Service) ListAttachments(ctx context.Context, cmd ListAttachmentsCommand) (ListAttachmentsResult, error) {
	limit := cmd.Limit
	if limit == 0 {
		limit = DefaultAttachmentListLimit
	}
	if limit < 1 || limit > MaxAttachmentListLimit {
		return ListAttachmentsResult{}, InvalidRequestError("limit 必须为 1 到 100 的整数", nil)
	}
	beforeSeq, err := decodeAttachmentListCursor(cmd.Cursor)
	if err != nil {
		return ListAttachmentsResult{}, InvalidRequestError("附件游标格式错误", err)
	}

	db := s.db.WithContext(ctx)
	member, err := requireReadableConversationMember(db, cmd.AccountID, cmd.ConversationID)
	if err != nil {
		return ListAttachmentsResult{}, mapHistoryAccessError(err)
	}
	visibleFromSeq := member.HistoryVisibleFromSeq
	if visibleFromSeq < 1 {
		visibleFromSeq = 1
	}

	now := time.Now().UTC()
	query := db.Model(&store.Message{}).
		Where("created_at >= ? AND created_at < ?", store.MessageOnlineCutoff(now), store.MessageOnlineEnd(now)).
		Where("conversation_id = ? AND deleted_at IS NULL AND revoked_at IS NULL AND seq >= ?", cmd.ConversationID, visibleFromSeq).
		Where(fileMessageTypeCondition(db), "file")
	if beforeSeq != nil {
		query = query.Where("seq < ?", *beforeSeq)
	}
	var messages []store.Message
	if err := query.Order("seq DESC").Limit(limit + 1).Find(&messages).Error; err != nil {
		return ListAttachmentsResult{}, internalError(err)
	}

	nextCursor := ""
	if len(messages) > limit {
		messages = messages[:limit]
		nextCursor = strconv.FormatInt(messages[len(messages)-1].Seq, 10)
	}
	attachments := make([]Attachment, 0, len(messages))
	for _, message := range messages {
		var body storedFileMessageBody
		if err := json.Unmarshal(message.Body, &body); err != nil {
			return ListAttachmentsResult{}, internalError(err)
		}
		attachments = append(attachments, Attachment{
			CreatedAt: message.CreatedAt, FileID: body.FileID, MessageID: message.ID,
			Name: body.Name, Seq: message.Seq, SizeBytes: body.SizeBytes,
		})
	}
	return ListAttachmentsResult{Attachments: attachments, NextCursor: nextCursor}, nil
}

func decodeAttachmentListCursor(raw string) (*int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 1 {
		return nil, strconv.ErrSyntax
	}
	return &value, nil
}

func fileMessageTypeCondition(db *gorm.DB) string {
	if db.Dialector.Name() == "postgres" {
		return "body->>'type' = ?"
	}
	return "json_extract(body, '$.type') = ?"
}
