-- +goose Up
CREATE TABLE document_contributors (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  first_edited_at timestamptz NOT NULL,
  last_edited_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, user_id),
  CONSTRAINT document_contributors_time_check CHECK (last_edited_at >= first_edited_at)
);

CREATE INDEX document_contributors_document_last_edited_index
  ON document_contributors (document_id, last_edited_at DESC, user_id);

INSERT INTO document_contributors (document_id, user_id, first_edited_at, last_edited_at)
SELECT id, created_by_user_id, created_at, created_at
FROM documents;

INSERT INTO document_contributors (document_id, user_id, first_edited_at, last_edited_at)
SELECT id, updated_by_user_id, updated_at, updated_at
FROM documents
ON CONFLICT (document_id, user_id) DO UPDATE SET
  first_edited_at = LEAST(document_contributors.first_edited_at, EXCLUDED.first_edited_at),
  last_edited_at = GREATEST(document_contributors.last_edited_at, EXCLUDED.last_edited_at);

-- +goose Down
DROP TABLE document_contributors;
