package document

import (
	"context"
	"time"
)

const (
	KindFolder   = "folder"
	KindDocument = "document"
)

type Field[T any] struct {
	Present bool
	Null    bool
	Value   T
}

type UserSummary struct {
	ID       string
	Name     string
	Nickname string
	Avatar   string
}

type Document struct {
	ID            string
	ProjectID     string
	ParentID      *string
	Kind          string
	DocumentType  *string
	Title         string
	SortOrder     int64
	SchemaVersion int
	Creator       UserSummary
	UpdatedBy     UserSummary
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type ListCommand struct {
	AccountID string
	ProjectID string
}

type CreateCommand struct {
	AccountID string
	ProjectID string
	Kind      Field[string]
	Title     Field[string]
	ParentID  Field[string]
}

type GetCommand struct {
	AccountID  string
	DocumentID string
}

type UpdateCommand struct {
	AccountID  string
	DocumentID string
	Title      Field[string]
	ParentID   Field[string]
	SortOrder  Field[int64]
}

type MoveCommand struct {
	AccountID  string
	DocumentID string
	ParentID   Field[string]
	Index      int64
}

type DeleteResult struct {
	DocumentID   string
	DeletedCount int64
}

type ClientService interface {
	List(context.Context, ListCommand) ([]Document, error)
	Create(context.Context, CreateCommand) (Document, error)
	Get(context.Context, GetCommand) (Document, error)
	Update(context.Context, UpdateCommand) (Document, error)
	Move(context.Context, MoveCommand) (Document, error)
	Delete(context.Context, GetCommand) (DeleteResult, error)
}
