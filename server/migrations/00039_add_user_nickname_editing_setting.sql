-- +goose Up
ALTER TABLE app_settings
    ADD COLUMN allow_user_nickname_editing boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE app_settings
    DROP COLUMN allow_user_nickname_editing;
