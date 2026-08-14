import type { SQLiteDatabase } from "expo-sqlite"
import { Platform } from "react-native"

import {
  createMessageCacheMigrationSQL,
  MESSAGE_CACHE_DATABASE_VERSION,
} from "@/data/messages/message-cache-version"

const DATABASE_NAME = "magicchat-messages-v1.db"

let databasePromise: Promise<SQLiteDatabase | null> | null = null

export async function getGlobalMessageCacheSize(): Promise<number> {
  const database = await getMessageCacheDatabase()
  if (!database) return 0
  const result = await database.getFirstAsync<{ bytes: number }>(
    `SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB)) + 256), 0) AS bytes FROM cached_messages`
  )
  return result?.bytes ?? 0
}

export async function clearGlobalMessageCache(): Promise<void> {
  const database = await getMessageCacheDatabase()
  if (!database) return
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(
      `DELETE FROM cached_messages; DELETE FROM message_sync_state; DELETE FROM message_cache_stats;`
    )
  })
  await database.execAsync("PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;").catch(() => undefined)
}

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

    if (
      (version?.user_version ?? 0) < MESSAGE_CACHE_DATABASE_VERSION
    ) {
      await migrateDatabase(database, version?.user_version ?? 0)
    }

    return database
  } catch (error) {
    await database.closeAsync().catch(() => undefined)
    throw error
  }
}

async function migrateDatabase(
  database: SQLiteDatabase,
  previousVersion: number
) {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(createMessageCacheMigrationSQL(previousVersion))
  })
}
