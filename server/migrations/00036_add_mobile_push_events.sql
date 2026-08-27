-- +goose Up
CREATE TABLE mobile_push_events (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL UNIQUE REFERENCES message_registry(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_seq bigint NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  locked_at timestamptz,
  lock_token text NOT NULL DEFAULT '',
  last_error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT mobile_push_events_status_check CHECK (status IN ('queued', 'expanding', 'retry', 'expired')),
  CONSTRAINT mobile_push_events_attempts_check CHECK (attempts >= 0),
  CONSTRAINT mobile_push_events_message_seq_check CHECK (message_seq > 0)
);

CREATE INDEX mobile_push_events_dispatch_index
  ON mobile_push_events (status, next_attempt_at, created_at);

-- +goose Down
DROP TABLE mobile_push_events;
