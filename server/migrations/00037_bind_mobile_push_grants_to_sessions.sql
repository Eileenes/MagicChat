-- +goose Up
-- Existing grants cannot be mapped safely to a particular login session. Drop
-- them so authenticated mobile clients recreate session-bound delegations.
DELETE FROM user_push_grants;

ALTER TABLE user_push_grants
  ADD COLUMN session_id uuid NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE;

CREATE INDEX user_push_grants_session_index ON user_push_grants (session_id);

-- +goose Down
DROP INDEX user_push_grants_session_index;
ALTER TABLE user_push_grants DROP COLUMN session_id;
