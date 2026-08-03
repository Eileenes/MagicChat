export type DocumentServerConfig = {
  allowedOrigins: ReadonlySet<string>;
  authRecheckMs: number;
  databaseConnectionTimeoutMs: number;
  databasePoolSize: number;
  databaseURL: string;
  host: string;
  maxMessageBytes: number;
  persistenceRetryInitialMs: number;
  persistenceRetryMaxMs: number;
  port: number;
  shutdownTimeoutMs: number;
  storeDebounceMs: number;
  storeMaxDebounceMs: number;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): DocumentServerConfig {
  const storeDebounceMs = positiveInteger(
    env.DOCUMENT_STORE_DEBOUNCE_MS,
    2_000,
    "DOCUMENT_STORE_DEBOUNCE_MS",
  );
  const storeMaxDebounceMs = positiveInteger(
    env.DOCUMENT_STORE_MAX_DEBOUNCE_MS,
    10_000,
    "DOCUMENT_STORE_MAX_DEBOUNCE_MS",
  );
  if (storeMaxDebounceMs < storeDebounceMs) {
    throw new Error(
      "DOCUMENT_STORE_MAX_DEBOUNCE_MS must be greater than or equal to DOCUMENT_STORE_DEBOUNCE_MS",
    );
  }

  const persistenceRetryInitialMs = positiveInteger(
    env.DOCUMENT_PERSISTENCE_RETRY_INITIAL_MS,
    250,
    "DOCUMENT_PERSISTENCE_RETRY_INITIAL_MS",
  );
  const persistenceRetryMaxMs = positiveInteger(
    env.DOCUMENT_PERSISTENCE_RETRY_MAX_MS,
    5_000,
    "DOCUMENT_PERSISTENCE_RETRY_MAX_MS",
  );
  if (persistenceRetryMaxMs < persistenceRetryInitialMs) {
    throw new Error(
      "DOCUMENT_PERSISTENCE_RETRY_MAX_MS must be greater than or equal to DOCUMENT_PERSISTENCE_RETRY_INITIAL_MS",
    );
  }

  return {
    allowedOrigins: new Set(
      splitCommaSeparated(env.DOCUMENT_ALLOWED_ORIGINS).map(normalizeOrigin),
    ),
    authRecheckMs: positiveInteger(
      env.DOCUMENT_AUTH_RECHECK_MS,
      30_000,
      "DOCUMENT_AUTH_RECHECK_MS",
    ),
    databaseConnectionTimeoutMs: positiveInteger(
      env.DOCUMENT_DB_CONNECTION_TIMEOUT_MS,
      5_000,
      "DOCUMENT_DB_CONNECTION_TIMEOUT_MS",
    ),
    databasePoolSize: positiveInteger(
      env.DOCUMENT_DB_POOL_SIZE,
      10,
      "DOCUMENT_DB_POOL_SIZE",
    ),
    databaseURL: databaseURL(env),
    host: env.DOCUMENT_SERVER_HOST?.trim() || "0.0.0.0",
    maxMessageBytes: positiveInteger(
      env.DOCUMENT_MAX_MESSAGE_BYTES,
      16 * 1024 * 1024,
      "DOCUMENT_MAX_MESSAGE_BYTES",
    ),
    persistenceRetryInitialMs,
    persistenceRetryMaxMs,
    port: positiveInteger(
      env.DOCUMENT_SERVER_PORT,
      20_100,
      "DOCUMENT_SERVER_PORT",
    ),
    shutdownTimeoutMs: positiveInteger(
      env.DOCUMENT_SHUTDOWN_TIMEOUT_MS,
      30_000,
      "DOCUMENT_SHUTDOWN_TIMEOUT_MS",
    ),
    storeDebounceMs,
    storeMaxDebounceMs,
  };
}

function databaseURL(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL?.trim()) return env.DATABASE_URL.trim();

  const host = env.POSTGRES_HOST?.trim() || "localhost";
  const port = positiveInteger(env.POSTGRES_PORT, 5_432, "POSTGRES_PORT");
  const database = env.POSTGRES_DB?.trim() || "app";
  const user = env.POSTGRES_USER?.trim() || "app";
  const password = env.POSTGRES_PASSWORD ?? "app";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `DOCUMENT_ALLOWED_ORIGINS contains an invalid origin: ${value}`,
    );
  }
  return url.origin;
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function splitCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
