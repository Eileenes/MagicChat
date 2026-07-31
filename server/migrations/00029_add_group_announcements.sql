-- +goose Up
ALTER TABLE conversations
  ADD COLUMN announcement text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE conversations
  DROP COLUMN announcement;
