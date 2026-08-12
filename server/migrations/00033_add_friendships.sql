-- +goose Up
ALTER TABLE app_settings
  ADD COLUMN contact_directory_mode text NOT NULL DEFAULT 'organization';

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_contact_directory_mode_check
  CHECK (contact_directory_mode IN ('organization', 'friends'));

CREATE TABLE user_friendships (
  user_id_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id_low, user_id_high),
  CONSTRAINT user_friendships_order_check CHECK (user_id_low::text < user_id_high::text)
);

CREATE INDEX user_friendships_high_index
  ON user_friendships (user_id_high, created_at DESC);

CREATE TABLE user_friend_requests (
  id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  handled_at timestamptz,
  CONSTRAINT user_friend_requests_users_check CHECK (requester_user_id <> addressee_user_id),
  CONSTRAINT user_friend_requests_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled'))
);

CREATE UNIQUE INDEX user_friend_requests_pending_pair_index
  ON user_friend_requests (
    LEAST(requester_user_id::text, addressee_user_id::text),
    GREATEST(requester_user_id::text, addressee_user_id::text)
  )
  WHERE status = 'pending';

CREATE INDEX user_friend_requests_requester_index
  ON user_friend_requests (requester_user_id, status, created_at DESC);

CREATE INDEX user_friend_requests_addressee_index
  ON user_friend_requests (addressee_user_id, status, created_at DESC);

-- +goose Down
DROP TABLE user_friend_requests;
DROP TABLE user_friendships;

ALTER TABLE app_settings
  DROP CONSTRAINT app_settings_contact_directory_mode_check;

ALTER TABLE app_settings
  DROP COLUMN contact_directory_mode;
