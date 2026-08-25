ALTER TABLE app_settings
    ADD COLUMN IF NOT EXISTS email_code_registration_enabled BOOLEAN NOT NULL DEFAULT FALSE;
