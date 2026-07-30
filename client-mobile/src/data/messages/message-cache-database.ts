import type { SQLiteDatabase } from "expo-sqlite"
import { Platform } from "react-native"

import {
  createMessageCacheMigrationSQL,
  MESSAGE_CACHE_DATABASE_VERSION,
} from "@/data/messages/message-cache-version"

const DATABASE_NAME = "magicchat-messages-v1.db"

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
