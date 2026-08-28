-- +goose Up
ALTER TABLE push_jobs
  ADD COLUMN provider_request_id text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE push_jobs DROP COLUMN provider_request_id;
