-- +goose NO TRANSACTION
-- +goose Up
-- CREATE INDEX CONCURRENTLY may leave an invalid index after interruption.
-- Remove any partial attempt so this non-transactional migration is retryable.
DROP INDEX CONCURRENTLY IF EXISTS message_registry_conversation_search_order_index;
DROP INDEX CONCURRENTLY IF EXISTS message_registry_sender_search_order_index;

CREATE INDEX CONCURRENTLY message_registry_sender_search_order_index
  ON message_registry (sender_id, partition_year DESC, created_at DESC, id DESC)
  WHERE sender_id IS NOT NULL
    AND deleted_at IS NULL
    AND revoked_at IS NULL
    AND sender_type IN ('user', 'app');

CREATE INDEX CONCURRENTLY message_registry_conversation_search_order_index
  ON message_registry (conversation_id, partition_year DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL
    AND revoked_at IS NULL
    AND sender_type IN ('user', 'app');

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS message_registry_conversation_search_order_index;
DROP INDEX CONCURRENTLY IF EXISTS message_registry_sender_search_order_index;
