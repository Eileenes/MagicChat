-- +goose Up
CREATE TABLE account_deactivation_challenges (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email text NOT NULL, code_mac bytea NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX account_deactivation_challenges_user_index ON account_deactivation_challenges(user_id, created_at DESC);
-- +goose Down
DROP TABLE account_deactivation_challenges;
