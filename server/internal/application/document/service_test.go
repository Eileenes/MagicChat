package document

import (
	"context"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestServiceDocumentTreeLifecycle(t *testing.T) {
	db := openDocumentTestDB(t)
	now := time.Date(2026, 8, 5, 8, 0, 0, 0, time.UTC)
	owner := insertDocumentTestUser(t, db, "document-owner@example.com", now)
	project := insertDocumentTestProject(t, db, owner, "Product", now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})

	folder, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: KindFolder},
		Title: Field[string]{Present: true, Value: "  产品资料  "},
	})
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if folder.Kind != KindFolder || folder.DocumentType != nil || folder.Title != "产品资料" || folder.SortOrder != 0 {
		t.Fatalf("folder = %#v", folder)
	}

	rootDocument, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: KindDocument},
		Title: Field[string]{Present: true, Value: "项目说明"},
	})
	if err != nil {
		t.Fatalf("create root document: %v", err)
	}
	if rootDocument.DocumentType == nil || *rootDocument.DocumentType != store.DocumentTypeDocument || rootDocument.SortOrder != 1 {
		t.Fatalf("root document = %#v", rootDocument)
	}

	child, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:     Field[string]{Present: true, Value: KindDocument},
		Title:    Field[string]{Present: true, Value: "需求文档"},
		ParentID: Field[string]{Present: true, Value: folder.ID},
	})
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	if child.ParentID == nil || *child.ParentID != folder.ID || child.SortOrder != 0 {
		t.Fatalf("child = %#v", child)
	}

	listed, err := service.List(context.Background(), ListCommand{AccountID: owner.ID, ProjectID: project.ID})
	if err != nil || len(listed) != 3 {
		t.Fatalf("list = %#v, err = %v", listed, err)
	}

	now = now.Add(time.Minute)
	updated, err := service.Move(context.Background(), MoveCommand{
		AccountID: owner.ID, DocumentID: child.ID,
		ParentID: Field[string]{Present: true, Null: true}, Index: 2,
	})
	if err != nil {
		t.Fatalf("update child: %v", err)
	}
	if updated.Title != "需求文档" || updated.ParentID != nil || updated.SortOrder != 2 || updated.UpdatedBy.ID != owner.ID {
		t.Fatalf("updated = %#v", updated)
	}

	nestedFolder, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:     Field[string]{Present: true, Value: KindFolder},
		Title:    Field[string]{Present: true, Value: "归档"},
		ParentID: Field[string]{Present: true, Value: folder.ID},
	})
	if err != nil {
		t.Fatalf("create nested folder: %v", err)
	}
	nestedDocument, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:     Field[string]{Present: true, Value: KindDocument},
		Title:    Field[string]{Present: true, Value: "旧版本"},
		ParentID: Field[string]{Present: true, Value: nestedFolder.ID},
	})
	if err != nil {
		t.Fatalf("create nested document: %v", err)
	}

	_, err = service.Move(context.Background(), MoveCommand{
		AccountID: owner.ID, DocumentID: folder.ID,
		ParentID: Field[string]{Present: true, Value: nestedFolder.ID}, Index: 0,
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("cycle error = %v, code = %q", err, ErrorCodeOf(err))
	}

	now = now.Add(time.Minute)
	deleted, err := service.Delete(context.Background(), GetCommand{AccountID: owner.ID, DocumentID: folder.ID})
	if err != nil || deleted.DeletedCount != 3 {
		t.Fatalf("delete = %#v, err = %v", deleted, err)
	}
	if _, err := service.Get(context.Background(), GetCommand{AccountID: owner.ID, DocumentID: nestedDocument.ID}); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("get recursively deleted error = %v, code = %q", err, ErrorCodeOf(err))
	}
	if _, err := service.Get(context.Background(), GetCommand{AccountID: owner.ID, DocumentID: updated.ID}); err != nil {
		t.Fatalf("moved document was deleted: %v", err)
	}
}

func TestServiceRejectsUnsupportedKindsAndInvalidParents(t *testing.T) {
	db := openDocumentTestDB(t)
	now := time.Date(2026, 8, 5, 8, 0, 0, 0, time.UTC)
	owner := insertDocumentTestUser(t, db, "document-validation@example.com", now)
	project := insertDocumentTestProject(t, db, owner, "One", now)
	otherProject := insertDocumentTestProject(t, db, owner, "Two", now)
	service := NewService(Dependencies{DB: db})

	_, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: "markdown"},
		Title: Field[string]{Present: true, Value: "Unsupported"},
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("unsupported kind error = %v", err)
	}

	ordinary, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: KindDocument},
		Title: Field[string]{Present: true, Value: "Ordinary"},
	})
	if err != nil {
		t.Fatalf("create ordinary: %v", err)
	}
	_, err = service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:     Field[string]{Present: true, Value: KindDocument},
		Title:    Field[string]{Present: true, Value: "Invalid child"},
		ParentID: Field[string]{Present: true, Value: ordinary.ID},
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("document parent error = %v", err)
	}

	foreignFolder, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: otherProject.ID,
		Kind:  Field[string]{Present: true, Value: KindFolder},
		Title: Field[string]{Present: true, Value: "Foreign"},
	})
	if err != nil {
		t.Fatalf("create foreign folder: %v", err)
	}
	_, err = service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:     Field[string]{Present: true, Value: KindDocument},
		Title:    Field[string]{Present: true, Value: "Cross project"},
		ParentID: Field[string]{Present: true, Value: foreignFolder.ID},
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("cross-project parent error = %v", err)
	}
}

func TestServiceAllowsDerivedProjectMembersToManageDocuments(t *testing.T) {
	db := openDocumentTestDB(t)
	now := time.Date(2026, 8, 5, 8, 0, 0, 0, time.UTC)
	owner := insertDocumentTestUser(t, db, "document-member-owner@example.com", now)
	member := insertDocumentTestUser(t, db, "document-member@example.com", now)
	project := insertDocumentTestProject(t, db, owner, "Shared", now)
	conversation := store.Conversation{
		ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: "Shared group",
		CreatedByUserID: owner.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&store.ConversationMember{
		ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser,
		MemberID: member.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now,
		HistoryVisibleFromSeq: 1,
	}).Error; err != nil {
		t.Fatalf("create conversation member: %v", err)
	}
	if err := db.Create(&store.ProjectGroup{
		ProjectID: project.ID, ConversationID: conversation.ID,
		LinkedByUserID: owner.ID, CreatedAt: now,
	}).Error; err != nil {
		t.Fatalf("create project group: %v", err)
	}

	service := NewService(Dependencies{DB: db})
	created, err := service.Create(context.Background(), CreateCommand{
		AccountID: member.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: KindFolder},
		Title: Field[string]{Present: true, Value: "Member folder"},
	})
	if err != nil || created.Creator.ID != member.ID {
		t.Fatalf("member create = %#v, err = %v", created, err)
	}
	if _, err := service.Update(context.Background(), UpdateCommand{
		AccountID: member.ID, DocumentID: created.ID,
		Title: Field[string]{Present: true, Value: "Member folder updated"},
	}); err != nil {
		t.Fatalf("member update: %v", err)
	}
	if _, err := service.Delete(context.Background(), GetCommand{AccountID: member.ID, DocumentID: created.ID}); err != nil {
		t.Fatalf("member delete: %v", err)
	}
}

func TestServiceHidesDocumentsFromInaccessibleUsers(t *testing.T) {
	db := openDocumentTestDB(t)
	now := time.Date(2026, 8, 5, 8, 0, 0, 0, time.UTC)
	owner := insertDocumentTestUser(t, db, "document-private-owner@example.com", now)
	outsider := insertDocumentTestUser(t, db, "document-outsider@example.com", now)
	project := insertDocumentTestProject(t, db, owner, "Private", now)
	service := NewService(Dependencies{DB: db})
	created, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Kind:  Field[string]{Present: true, Value: KindDocument},
		Title: Field[string]{Present: true, Value: "Secret"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := service.List(context.Background(), ListCommand{AccountID: outsider.ID, ProjectID: project.ID}); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("outsider list error = %v, code = %q", err, ErrorCodeOf(err))
	}
	if _, err := service.Get(context.Background(), GetCommand{AccountID: outsider.ID, DocumentID: created.ID}); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("outsider get error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func openDocumentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&store.User{}, &store.Project{}, &store.Conversation{}, &store.ConversationMember{},
		&store.ProjectGroup{}, &store.Document{}, &store.DocumentCollabState{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func insertDocumentTestUser(t *testing.T, db *gorm.DB, email string, now time.Time) store.User {
	t.Helper()
	value := store.User{
		ID: uuid.NewString(), Email: email, Name: email, Avatar: store.DefaultUserAvatar,
		PasswordHash: "hash", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&value).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return value
}

func insertDocumentTestProject(t *testing.T, db *gorm.DB, owner store.User, name string, now time.Time) store.Project {
	t.Helper()
	value := store.Project{
		ID: uuid.NewString(), Name: name, OwnerUserID: owner.ID, CreatedByUserID: owner.ID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&value).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}
	return value
}
