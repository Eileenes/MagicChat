import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { assertDocumentName } from "./document-name.js";
import { cookieValue } from "./http-security.js";

const sessionCookieName = "user_session";

export class DocumentAuthorizationError extends Error {
  constructor() {
    super("permission-denied");
    this.name = "DocumentAuthorizationError";
  }
}

export type DocumentConnectionContext = {
  documentId: string;
  sessionId: string;
  userId: string;
};

export class DocumentAuthorizer {
  constructor(private readonly pool: Pool) {}

  async authorize(
    documentName: string,
    cookieHeader: string | null,
  ): Promise<DocumentConnectionContext> {
    assertDocumentName(documentName);
    const token = cookieValue(cookieHeader, sessionCookieName);
    if (!token) throw new DocumentAuthorizationError();

    const session = await this.pool.query<{
      session_id: string;
      user_id: string;
    }>(
      `
        SELECT us.id AS session_id, us.user_id
        FROM user_sessions us
        JOIN users u ON u.id = us.user_id
        WHERE us.token_hash = $1
          AND us.expires_at > now()
          AND u.status = 'active'
        LIMIT 1
      `,
      [hashSessionToken(token)],
    );
    const identity = session.rows[0];
    if (!identity) throw new DocumentAuthorizationError();

    await this.assertDocumentAccess(documentName, identity.user_id);

    void this.pool
      .query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [
        identity.session_id,
      ])
      .catch(() => undefined);

    return {
      documentId: documentName,
      sessionId: identity.session_id,
      userId: identity.user_id,
    };
  }

  async reauthorize(context: DocumentConnectionContext): Promise<void> {
    const session = await this.pool.query(
      `
        SELECT 1
        FROM user_sessions us
        JOIN users u ON u.id = us.user_id
        WHERE us.id = $1
          AND us.user_id = $2
          AND us.expires_at > now()
          AND u.status = 'active'
        LIMIT 1
      `,
      [context.sessionId, context.userId],
    );
    if (session.rowCount !== 1) throw new DocumentAuthorizationError();
    await this.assertDocumentAccess(context.documentId, context.userId);
  }

  private async assertDocumentAccess(
    documentId: string,
    userId: string,
  ): Promise<void> {
    const access = await this.pool.query(
      `
        SELECT 1
        FROM documents d
        JOIN projects p ON p.id = d.project_id
        WHERE d.id = $1
          AND d.kind = 'document'
          AND d.document_type = 'document'
          AND d.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND (
            p.owner_user_id = $2
            OR EXISTS (
              SELECT 1
              FROM project_groups pg
              JOIN conversations c ON c.id = pg.conversation_id
              JOIN conversation_members cm ON cm.conversation_id = c.id
              WHERE pg.project_id = p.id
                AND c.kind = 'group'
                AND c.status = 'active'
                AND cm.member_type = 'user'
                AND cm.member_id = $2
                AND cm.left_at IS NULL
            )
          )
        LIMIT 1
      `,
      [documentId, userId],
    );
    if (access.rowCount !== 1) throw new DocumentAuthorizationError();
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
