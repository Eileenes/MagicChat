-- +goose Up
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  kind text NOT NULL,
  document_type text,
  title text NOT NULL DEFAULT '无标题文档',
  sort_order bigint NOT NULL DEFAULT 0,
  schema_version integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT documents_kind_check CHECK (kind IN ('folder', 'document')),
  CONSTRAINT documents_type_check CHECK (
    (kind = 'folder' AND document_type IS NULL)
    OR (kind = 'document' AND document_type IN ('document', 'file', 'markdown', 'mindmap', 'spreadsheet'))
  ),
  CONSTRAINT documents_title_check CHECK (char_length(title) BETWEEN 1 AND 500),
  CONSTRAINT documents_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT documents_schema_version_check CHECK (schema_version > 0),
  CONSTRAINT documents_not_own_parent_check CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX documents_project_parent_order_index
  ON documents (project_id, parent_id, sort_order, id)
  WHERE deleted_at IS NULL;

CREATE INDEX documents_parent_id_index
  ON documents (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE TABLE document_collab_states (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  ydoc_state bytea NOT NULL,
  state_revision bigint NOT NULL DEFAULT 1,
  schema_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  CONSTRAINT document_collab_states_revision_check CHECK (state_revision > 0),
  CONSTRAINT document_collab_states_schema_version_check CHECK (schema_version > 0)
);

-- +goose Down
DROP TABLE document_collab_states;
DROP TABLE documents;
