export const MESSAGE_CACHE_DATABASE_VERSION = 4

export function requiresNormalizedMessageCacheReset(previousVersion: number) {
  return previousVersion < 4
}

export function createMessageCacheMigrationSQL(previousVersion: number) {
  const resetNormalizedMessages = requiresNormalizedMessageCacheReset(
    previousVersion
  )
    ? `DELETE FROM cached_messages;
       DELETE FROM message_sync_state;
       DELETE FROM message_cache_stats;`
    : ""

  return `
    CREATE TABLE IF NOT EXISTS cached_messages (
      server_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      reaction_version INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (server_key, user_id, conversation_id, message_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cached_messages_by_seq
    ON cached_messages (server_key, user_id, conversation_id, seq);

    CREATE INDEX IF NOT EXISTS cached_messages_recent
    ON cached_messages (server_key, user_id, conversation_id, seq DESC);

    CREATE TABLE IF NOT EXISTS message_sync_state (
      server_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      http_synced_through_seq INTEGER NOT NULL DEFAULT 0,
      oldest_cached_seq INTEGER,
      has_more_before INTEGER NOT NULL DEFAULT 1,
      last_synced_at INTEGER,
      last_accessed_at INTEGER NOT NULL,
      PRIMARY KEY (server_key, user_id, conversation_id)
    );

    CREATE INDEX IF NOT EXISTS message_sync_state_lru
    ON message_sync_state (last_accessed_at ASC);

    CREATE TABLE IF NOT EXISTS message_cache_stats (
      server_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      payload_bytes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (server_key, user_id, conversation_id)
    );

    ${resetNormalizedMessages}

    DELETE FROM message_cache_stats;

    INSERT INTO message_cache_stats (
      server_key, user_id, conversation_id, message_count, payload_bytes
    )
    SELECT server_key, user_id, conversation_id, COUNT(*),
           COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
      FROM cached_messages
     GROUP BY server_key, user_id, conversation_id;

    PRAGMA user_version = ${MESSAGE_CACHE_DATABASE_VERSION};
  `
}
