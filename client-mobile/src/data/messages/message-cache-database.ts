import type { SQLiteDatabase } from "expo-sqlite"
import { Platform } from "react-native"

const DATABASE_NAME = "magicchat-messages-v1.db"
const DATABASE_VERSION = 2

let databasePromise: Promise<SQLiteDatabase | null> | null = null

export function getMessageCacheDatabase() {
  if (Platform.OS === "web") {
    return Promise.resolve(null)
  }

  if (!databasePromise) {
    databasePromise = openMessageCacheDatabase().catch((error) => {
      databasePromise = null
      throw error
    })
  }

  return databasePromise
}

async function openMessageCacheDatabase() {
  const { openDatabaseAsync } = await import("expo-sqlite")
  const database = await openDatabaseAsync(DATABASE_NAME)

  try {
    await database.execAsync("PRAGMA journal_mode = WAL;")
    const version = await database.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version"
    )

    if ((version?.user_version ?? 0) < DATABASE_VERSION) {
      await migrateDatabase(database)
    }

    return database
  } catch (error) {
    await database.closeAsync().catch(() => undefined)
    throw error
  }
}

async function migrateDatabase(database: SQLiteDatabase) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(`
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

      DELETE FROM message_cache_stats;

      INSERT INTO message_cache_stats (
        server_key, user_id, conversation_id, message_count, payload_bytes
      )
      SELECT server_key, user_id, conversation_id, COUNT(*),
             COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
        FROM cached_messages
       GROUP BY server_key, user_id, conversation_id;

      PRAGMA user_version = ${DATABASE_VERSION};
    `)
  })
}
