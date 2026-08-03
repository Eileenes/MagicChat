import type { IncomingMessage, ServerResponse } from "node:http";

import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import { Pool } from "pg";

import { scheduleAuthorizationRecheck } from "./auth-recheck.js";
import {
  DocumentAuthorizationError,
  DocumentAuthorizer,
  type DocumentConnectionContext,
} from "./auth.js";
import type { DocumentServerConfig } from "./config.js";
import { assertDocumentName } from "./document-name.js";
import { DocumentStore, normalizeTitle } from "./document-store.js";
import { assertAllowedOrigin } from "./http-security.js";
import { PersistenceRetry, withTimeout } from "./persistence-retry.js";

export type RunningDocumentServer = {
  close: () => Promise<void>;
  listen: () => Promise<void>;
};

export function createDocumentServer(
  config: DocumentServerConfig,
): RunningDocumentServer {
  const pool = new Pool({
    connectionString: config.databaseURL,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    max: config.databasePoolSize,
    query_timeout: config.databaseConnectionTimeoutMs,
  });
  const store = new DocumentStore(pool);
  const authorizer = new DocumentAuthorizer(pool);
  const persistenceRetry = new PersistenceRetry({
    initialDelayMs: config.persistenceRetryInitialMs,
    maximumDelayMs: config.persistenceRetryMaxMs,
    onRetry: (error, retryInMs) => {
      console.error(
        `document persistence failed; retrying in ${retryInMs}ms`,
        error,
      );
    },
  });

  const server = new Server<DocumentConnectionContext>({
    address: config.host,
    debounce: config.storeDebounceMs,
    maxDebounce: config.storeMaxDebounceMs,
    name: "dianbao-document-server",
    port: config.port,
    quiet: true,
    stopOnSignals: false,
    unloadImmediately: false,
    websocketOptions: { maxPayload: config.maxMessageBytes },
    extensions: [
      new Database({
        fetch: ({ documentName }) => store.fetch(documentName),
        store: ({ document, documentName, lastContext, state }) =>
          persistenceRetry.run(() =>
            store.store(
              documentName,
              state,
              document.getText("title").toString(),
              lastContext?.userId,
            ),
          ),
      }),
    ],
    onUpgrade: async ({ request, socket }) => {
      try {
        assertAllowedOrigin(request.headers, config.allowedOrigins);
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        throw null;
      }
    },
    onConnect: async ({ documentName }) => {
      assertDocumentName(documentName);
    },
    onAuthenticate: async ({ documentName, requestHeaders }) =>
      authorizer.authorize(documentName, requestHeaders.get("cookie")),
    connected: async ({ connection, context }) => {
      scheduleAuthorizationRecheck(
        authorizer,
        connection,
        context,
        config.authRecheckMs,
      );
    },
    onRequest: async ({ request, response }) => {
      const path = requestPath(request);
      if (path === "/healthz") {
        try {
          if (!persistenceRetry.healthy) {
            throw new Error("document persistence is retrying");
          }
          await store.ping();
          sendJSON(response, 200, { status: "ok" });
        } catch {
          sendJSON(response, 503, { status: "unavailable" });
        }
        throw null;
      }

      const titleMatch = path.match(
        /^\/api\/client\/document\/collaboration\/([0-9a-f-]+)\/title$/i,
      );
      if (request.method !== "PATCH" || !titleMatch?.[1]) return;
      try {
        try {
          assertAllowedOrigin(request.headers, config.allowedOrigins);
        } catch {
          throw new HTTPRequestError("请求来源不受信任", 403);
        }
        const documentId = titleMatch[1];
        try {
          assertDocumentName(documentId);
        } catch {
          throw new HTTPRequestError("文档 ID 格式错误", 400);
        }
        const body = await readJSONBody(request);
        const context = await authorizer.authorize(
          documentId,
          request.headers.cookie ?? null,
        );
        const title = normalizeTitle(
          typeof body.title === "string" ? body.title : "",
        );
        const connection = await server.hocuspocus.openDirectConnection(
          documentId,
          context,
        );
        try {
          await connection.transact((document) => {
            const sharedTitle = document.getText("title");
            if (sharedTitle.toString() === title) return;
            sharedTitle.delete(0, sharedTitle.length);
            sharedTitle.insert(0, title);
          });
        } finally {
          await connection.disconnect();
        }
        sendJSON(response, 200, {
          data: { document_id: documentId, title },
          success: true,
        });
      } catch (error) {
        const status =
          error instanceof HTTPRequestError
            ? error.status
            : error instanceof DocumentAuthorizationError
              ? 403
              : 503;
        if (status === 503) {
          console.error("failed to update collaborative document title", error);
        }
        sendJSON(response, status, {
          error: {
            code:
              status === 400
                ? "invalid_request"
                : status === 403
                  ? "forbidden"
                  : "service_unavailable",
            message:
              error instanceof HTTPRequestError
                ? error.message
                : status === 403
                  ? "无权修改文档标题"
                  : "文档服务暂时不可用，请稍后重试",
          },
          success: false,
        });
      }
      throw null;
    },
  });

  let closePromise: Promise<void> | undefined;
  async function close(): Promise<void> {
    try {
      await withTimeout(
        server.destroy(),
        config.shutdownTimeoutMs,
        "document server shutdown timed out while persisting documents",
      );
    } catch (error) {
      persistenceRetry.stop();
      await store.close();
      throw error;
    }
    persistenceRetry.stop();
    await store.close();
  }

  return {
    async listen() {
      await server.listen();
    },
    close() {
      closePromise ??= close();
      return closePromise;
    },
  };
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url || "/", "http://localhost").pathname;
}

function sendJSON(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

class HTTPRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readJSONBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 16 * 1024) {
      throw new HTTPRequestError("请求内容过大", 400);
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid body");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new HTTPRequestError("请求格式错误", 400);
  }
}
