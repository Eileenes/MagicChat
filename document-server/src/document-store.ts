import type { Pool, PoolClient } from "pg"
import * as Y from "yjs"

import { assertDocumentName } from "./document-name.js"

const defaultTitle = "无标题文档"
const maximumTitleCharacters = 500

export class DocumentStore {
  constructor(private readonly pool: Pool) {}

  async fetch(documentName: string): Promise<Uint8Array | null> {
    assertDocumentName(documentName)
    const result = await this.pool.query<{
      title: string
      ydoc_state: Buffer | null
    }>(
      `
        SELECT d.title, s.ydoc_state
        FROM documents d
        LEFT JOIN document_collab_states s ON s.document_id = d.id
        WHERE d.id = $1
          AND d.deleted_at IS NULL
          AND d.kind = 'document'
          AND d.document_type = 'document'
      `,
      [documentName]
    )
    const row = result.rows[0]
    if (!row) return null
    if (row.ydoc_state) return row.ydoc_state

    const initialState = createInitialState(row.title)
    const inserted = await this.pool.query<{ ydoc_state: Buffer }>(
      `
        INSERT INTO document_collab_states (
          document_id, ydoc_state, state_revision, schema_version, updated_at
        ) VALUES ($1, $2, 1, 1, now())
        ON CONFLICT (document_id) DO NOTHING
        RETURNING ydoc_state
      `,
      [documentName, Buffer.from(initialState)]
    )
    if (inserted.rows[0]) return inserted.rows[0].ydoc_state

    const existing = await this.pool.query<{ ydoc_state: Buffer }>(
      "SELECT ydoc_state FROM document_collab_states WHERE document_id = $1",
      [documentName]
    )
    return existing.rows[0]?.ydoc_state ?? null
  }

  async store(
    documentName: string,
    state: Uint8Array,
    title: string,
    updatedByUserId?: string
  ): Promise<void> {
    assertDocumentName(documentName)
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      if (!(await this.lockActiveDocument(client, documentName))) {
        await client.query("COMMIT")
        return
      }
      await client.query(
        `
          INSERT INTO document_collab_states (
            document_id, ydoc_state, state_revision, schema_version, updated_at
          ) VALUES ($1, $2, 1, 1, now())
          ON CONFLICT (document_id) DO UPDATE SET
            ydoc_state = EXCLUDED.ydoc_state,
            state_revision = document_collab_states.state_revision + 1,
            updated_at = now()
        `,
        [documentName, Buffer.from(state)]
      )
      await client.query(
        `
          UPDATE documents
          SET title = $2,
              updated_by_user_id = COALESCE($3, updated_by_user_id),
              updated_at = now()
          WHERE id = $1
        `,
        [documentName, normalizeTitle(title), updatedByUserId ?? null]
      )
      await client.query("COMMIT")
    } catch (error) {
      await rollback(client)
      throw error
    } finally {
      client.release()
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1")
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async lockActiveDocument(
    client: PoolClient,
    documentName: string
  ): Promise<boolean> {
    const result = await client.query(
      `
        SELECT 1
        FROM documents
        WHERE id = $1
          AND deleted_at IS NULL
          AND kind = 'document'
          AND document_type = 'document'
        FOR UPDATE
      `,
      [documentName]
    )
    return result.rowCount === 1
  }
}

export function createInitialState(title: string): Uint8Array {
  const document = new Y.Doc()
  document.getText("title").insert(0, normalizeTitle(title))
  document.getXmlFragment("body")
  return Y.encodeStateAsUpdate(document)
}

export function normalizeTitle(title: string): string {
  const cleaned = title.replaceAll("\0", "").trim()
  if (!cleaned) return defaultTitle
  return Array.from(cleaned).slice(0, maximumTitleCharacters).join("")
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK")
  } catch {
    // Preserve the original transaction error.
  }
}
