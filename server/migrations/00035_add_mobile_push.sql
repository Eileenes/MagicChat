-- +goose Up
CREATE TABLE user_push_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL UNIQUE,
  gateway_grant_id uuid NOT NULL UNIQUE,
  send_token_ciphertext bytea NOT NULL,
  platform text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT user_push_grants_platform_check CHECK (platform IN ('android', 'ios')),
  CONSTRAINT user_push_grants_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX user_push_grants_user_active_index
  ON user_push_grants (user_id, status, expires_at);

CREATE TABLE mobile_push_routes (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX mobile_push_routes_expiration_index ON mobile_push_routes (expires_at);

CREATE TABLE mobile_push_jobs (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES user_push_grants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  route_token_ciphertext bytea NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  locked_at timestamptz,
  lock_token text NOT NULL DEFAULT '',
  last_error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT mobile_push_jobs_status_check CHECK (status IN ('queued', 'sending', 'retry', 'sent', 'failed', 'expired')),
  CONSTRAINT mobile_push_jobs_attempts_check CHECK (attempts >= 0),
  CONSTRAINT mobile_push_jobs_grant_message_unique UNIQUE (grant_id, message_id)
);

CREATE INDEX mobile_push_jobs_dispatch_index
  ON mobile_push_jobs (status, next_attempt_at, created_at);
CREATE INDEX mobile_push_jobs_user_message_index
  ON mobile_push_jobs (user_id, message_id);

-- +goose Down
DROP TABLE mobile_push_jobs;
DROP TABLE mobile_push_routes;
DROP TABLE user_push_grants;
