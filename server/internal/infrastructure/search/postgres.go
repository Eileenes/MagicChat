package search

import (
	"context"
	"fmt"
	"strings"

	searchapp "app/internal/application/search"
	"app/internal/store"

	"gorm.io/gorm"
)

type PostgresMessageBackend struct {
	db *gorm.DB
}

func NewPostgresMessageBackend(db *gorm.DB) *PostgresMessageBackend {
	return &PostgresMessageBackend{db: db}
}

func (b *PostgresMessageBackend) SearchCandidates(ctx context.Context, query searchapp.CandidateQuery) (searchapp.CandidatePage, error) {
	if b.db == nil {
		return searchapp.CandidatePage{}, fmt.Errorf("database is required")
	}
	db := b.db.WithContext(ctx)
	table := "messages"
	partitioned := store.MessagePartitioningEnabled(db)
	if partitioned {
		table = "message_registry"
	}
	accessibleConversations := userAccessibleConversations(
		db, query.AccountID, query.ConversationID,
	)
	var candidates []searchapp.Candidate
	var err error
	if partitioned {
		candidates, err = scanPartitionedCandidates(
			db, table, accessibleConversations, query,
		)
	} else {
		candidates, err = scanCandidates(
			applyCandidateBounds(
				joinAccessibleConversations(
					db.Table(table+" AS search_messages"), accessibleConversations,
				),
				query,
				false,
				"search_messages",
			),
			query,
			false,
		)
	}
	if err != nil {
		return searchapp.CandidatePage{}, err
	}
	return searchapp.CandidatePage{
		Candidates: candidates,
		Exhausted:  len(candidates) < query.Limit,
	}, nil
}

func scanPartitionedCandidates(
	db *gorm.DB,
	table string,
	accessibleConversations *gorm.DB,
	query searchapp.CandidateQuery,
) ([]searchapp.Candidate, error) {
	if query.SenderID != "" {
		return scanCandidates(
			applyCandidateBounds(
				joinAccessibleConversations(
					db.Table(table+" AS search_messages"), accessibleConversations,
				),
				query,
				true,
				"search_messages",
			),
			query,
			true,
		)
	}

	conversationMessages := applyCandidateBounds(
		db.Table(table+" AS conversation_messages"),
		query,
		true,
		"conversation_messages",
	).
		Select(candidateSelect("conversation_messages", true)).
		Where("conversation_messages.conversation_id = accessible_search_conversations.conversation_id").
		Where("conversation_messages.seq >= accessible_search_conversations.visible_from_seq").
		Where("conversation_messages.summary LIKE ? ESCAPE '\\'", literalLikePattern(query.Keyword)).
		Order(candidateOrder("conversation_messages", true)).
		Limit(query.Limit)

	var candidates []searchapp.Candidate
	err := db.Table("(?) AS accessible_search_conversations", accessibleConversations).
		Joins("JOIN LATERAL (?) AS search_messages ON TRUE", conversationMessages).
		Select("search_messages.id, search_messages.conversation_id, search_messages.seq, search_messages.created_at").
		Order(candidateOrder("search_messages", true)).
		Limit(query.Limit).
		Scan(&candidates).Error
	return candidates, err
}

func scanCandidates(db *gorm.DB, query searchapp.CandidateQuery, partitioned bool) ([]searchapp.Candidate, error) {
	var candidates []searchapp.Candidate
	err := db.
		Select("search_messages.id, search_messages.conversation_id, search_messages.seq, search_messages.created_at").
		Where("search_messages.summary LIKE ? ESCAPE '\\'", literalLikePattern(query.Keyword)).
		Order(candidateOrder("search_messages", partitioned)).
		Limit(query.Limit).
		Scan(&candidates).Error
	return candidates, err
}

func userAccessibleConversations(db *gorm.DB, accountID string, conversationID string) *gorm.DB {
	ordinary := db.Table("conversations AS accessible_conversation").
		Select(`accessible_conversation.id AS conversation_id,
CASE WHEN accessible_member.history_visible_from_seq < 1 THEN 1
ELSE accessible_member.history_visible_from_seq END AS visible_from_seq`).
		Joins(`JOIN conversation_members accessible_member
ON accessible_member.conversation_id = accessible_conversation.id`).
		Where("accessible_conversation.kind <> ?", store.ConversationKindTopic).
		Where("accessible_conversation.status = ?", store.ConversationStatusActive).
		Where("accessible_member.member_type = ?", store.ConversationMemberTypeUser).
		Where("accessible_member.member_id = ?", accountID).
		Where("accessible_member.left_at IS NULL")
	if conversationID != "" {
		ordinary = ordinary.Where("accessible_conversation.id = ?", conversationID)
	}

	topics := db.Table("conversations AS accessible_topic").
		Select(`accessible_topic.id AS conversation_id,
CASE WHEN accessible_participant.history_visible_from_seq < 1 THEN 1
ELSE accessible_participant.history_visible_from_seq END AS visible_from_seq`).
		Joins(`JOIN conversation_topics accessible_topic_record
ON accessible_topic_record.conversation_id = accessible_topic.id`).
		Joins(`JOIN conversations accessible_parent
ON accessible_parent.id = accessible_topic_record.parent_conversation_id`).
		Joins(`JOIN conversation_members accessible_parent_member
ON accessible_parent_member.conversation_id = accessible_parent.id`).
		Joins(`JOIN conversation_topic_participants accessible_participant
ON accessible_participant.conversation_id = accessible_topic.id`).
		Where("accessible_topic.kind = ?", store.ConversationKindTopic).
		Where("accessible_topic.status = ?", store.ConversationStatusActive).
		Where("accessible_parent.status = ?", store.ConversationStatusActive).
		Where("accessible_parent_member.member_type = ?", store.ConversationMemberTypeUser).
		Where("accessible_parent_member.member_id = ?", accountID).
		Where("accessible_parent_member.left_at IS NULL").
		Where(`accessible_topic_record.source_message_seq >= CASE
WHEN accessible_parent_member.history_visible_from_seq < 1 THEN 1
ELSE accessible_parent_member.history_visible_from_seq END`).
		Where("accessible_participant.participant_type = ?", store.ConversationMemberTypeUser).
		Where("accessible_participant.participant_id = ?", accountID)
	if conversationID != "" {
		topics = topics.Where("accessible_topic.id = ?", conversationID)
	}

	return db.Raw(
		"SELECT * FROM (?) AS ordinary_access UNION ALL SELECT * FROM (?) AS topic_access",
		ordinary,
		topics,
	)
}

func joinAccessibleConversations(db *gorm.DB, accessibleConversations *gorm.DB) *gorm.DB {
	return db.Joins(`JOIN (?) AS accessible_search_conversations
ON accessible_search_conversations.conversation_id = search_messages.conversation_id
AND search_messages.seq >= accessible_search_conversations.visible_from_seq`, accessibleConversations)
}

func applyCandidateBounds(
	db *gorm.DB,
	query searchapp.CandidateQuery,
	partitioned bool,
	alias string,
) *gorm.DB {
	db = db.
		Where(alias+".created_at >= ? AND "+alias+".created_at <= ?", query.From, query.To).
		Where(alias + ".deleted_at IS NULL AND " + alias + ".revoked_at IS NULL").
		Where(alias + ".sender_type IN ('user', 'app')")
	if partitioned {
		db = db.Where(
			alias+".partition_year >= ? AND "+alias+".partition_year <= ?",
			query.From.Year(), query.To.Year(),
		)
	}
	if query.SenderID != "" {
		db = db.Where(alias+".sender_id = ?", query.SenderID)
	}
	if query.ConversationID != "" {
		db = db.Where(alias+".conversation_id = ?", query.ConversationID)
	}
	if query.Before != nil {
		db = db.Where(
			"("+alias+".created_at < ? OR ("+alias+".created_at = ? AND "+alias+".id < ?))",
			query.Before.CreatedAt, query.Before.CreatedAt, query.Before.ID,
		)
	}
	return db
}

func candidateSelect(alias string, partitioned bool) string {
	columns := alias + ".id, " + alias + ".conversation_id, " + alias + ".seq, " + alias + ".created_at"
	if partitioned {
		columns += ", " + alias + ".partition_year"
	}
	return columns
}

func candidateOrder(alias string, partitioned bool) string {
	if partitioned {
		return alias + ".partition_year DESC, " + alias + ".created_at DESC, " + alias + ".id DESC"
	}
	return alias + ".created_at DESC, " + alias + ".id DESC"
}

func literalLikePattern(keyword string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + replacer.Replace(keyword) + "%"
}

var _ searchapp.MessageBackend = (*PostgresMessageBackend)(nil)
