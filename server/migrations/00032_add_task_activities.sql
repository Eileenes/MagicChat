-- +goose Up
CREATE TABLE task_activities (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content text NOT NULL DEFAULT '',
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT task_activities_type_check CHECK (type IN ('created', 'updated', 'commented')),
  CONSTRAINT task_activities_content_check CHECK (
    (type = 'commented' AND char_length(btrim(content)) BETWEEN 1 AND 10000)
    OR (type <> 'commented' AND content = '')
  )
);

CREATE INDEX task_activities_task_created_at_index
  ON task_activities (task_id, created_at DESC, id DESC);

CREATE INDEX task_activities_project_created_at_index
  ON task_activities (project_id, created_at DESC, id DESC);

-- +goose Down
DROP TABLE task_activities;
