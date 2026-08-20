package document

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maximumHierarchyDepth = 64

var (
	errInvalidHierarchy           = errors.New("invalid document hierarchy")
	errCollaborativeTitleRequired = errors.New("document title requires collaboration service")
)

type Dependencies struct {
	DB  *gorm.DB
	Now func() time.Time
}

type Service struct {
	db  *gorm.DB
	now func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: deps.DB, now: now}
}

func (s *Service) List(ctx context.Context, cmd ListCommand) ([]Document, error) {
	projectID, err := parseUUID(cmd.ProjectID, "项目 ID 格式错误")
	if err != nil {
		return nil, err
	}
	if err := requireProjectAccess(s.db.WithContext(ctx), projectID, strings.TrimSpace(cmd.AccountID), false); err != nil {
		return nil, mapLookupError(err)
	}
	var values []store.Document
	err = preloadDocumentRelations(s.db.WithContext(ctx)).
		Where("project_id = ?", projectID).
		Order("parent_id NULLS FIRST").
		Order("sort_order ASC").
		Order("id ASC").
		Find(&values).Error
	if err != nil {
		return nil, internalError(err)
	}
	result := make([]Document, 0, len(values))
	for _, value := range values {
		result = append(result, newDocument(value))
	}
	return result, nil
}

func (s *Service) Create(ctx context.Context, cmd CreateCommand) (Document, error) {
	projectID, err := parseUUID(cmd.ProjectID, "项目 ID 格式错误")
	if err != nil {
		return Document{}, err
	}
	kind, documentType, err := normalizeKind(cmd.Kind, cmd.DocumentType)
	if err != nil {
		return Document{}, err
	}
	title, err := normalizeTitle(cmd.Title, kind)
	if err != nil {
		return Document{}, err
	}
	parentID, err := normalizeParent(cmd.ParentID)
	if err != nil {
		return Document{}, err
	}
	accountID := strings.TrimSpace(cmd.AccountID)
	var value store.Document
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireProjectAccess(tx, projectID, accountID, true); err != nil {
			return err
		}
		if err := validateParent(tx, projectID, parentID, ""); err != nil {
			return err
		}
		sortOrder, err := nextSortOrder(tx, projectID, parentID)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		value = store.Document{
			ID: uuid.NewString(), ProjectID: projectID, ParentID: parentID,
			Kind: kind, DocumentType: documentType, Title: title, SortOrder: sortOrder, SchemaVersion: 1,
			CreatedByUserID: accountID, UpdatedByUserID: accountID, CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Create(&value).Error; err != nil {
			return err
		}
		if err := upsertDocumentContributor(tx, value.ID, accountID, now); err != nil {
			return err
		}
		return updateProjectTimestamp(tx, projectID, now)
	})
	if err != nil {
		return Document{}, mapMutationError(err)
	}
	if err := s.loadRelations(ctx, &value); err != nil {
		return Document{}, err
	}
	return newDocument(value), nil
}

func (s *Service) Get(ctx context.Context, cmd GetCommand) (Document, error) {
	documentID, err := parseUUID(cmd.DocumentID, "文档 ID 格式错误")
	if err != nil {
		return Document{}, err
	}
	var value store.Document
	err = preloadDocumentRelations(s.db.WithContext(ctx)).First(&value, "id = ?", documentID).Error
	if err != nil {
		return Document{}, mapLookupError(err)
	}
	if err := requireProjectAccess(s.db.WithContext(ctx), value.ProjectID, strings.TrimSpace(cmd.AccountID), false); err != nil {
		return Document{}, mapLookupError(err)
	}
	return newDocument(value), nil
}

func (s *Service) Update(ctx context.Context, cmd UpdateCommand) (Document, error) {
	documentID, err := parseUUID(cmd.DocumentID, "文档 ID 格式错误")
	if err != nil {
		return Document{}, err
	}
	if !cmd.Title.Present && !cmd.ParentID.Present && !cmd.SortOrder.Present {
		return Document{}, invalid("至少需要修改一个字段", nil)
	}
	var title *string
	if cmd.Title.Present {
		value, err := normalizeTitle(cmd.Title, KindDocument)
		if err != nil {
			return Document{}, err
		}
		title = &value
	}
	parentID, err := normalizeParent(cmd.ParentID)
	if err != nil {
		return Document{}, err
	}
	if cmd.SortOrder.Present && (cmd.SortOrder.Null || cmd.SortOrder.Value < 0) {
		return Document{}, invalid("sort_order 必须是非负整数", nil)
	}
	accountID := strings.TrimSpace(cmd.AccountID)
	var value store.Document
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing store.Document
		if err := tx.First(&existing, "id = ?", documentID).Error; err != nil {
			return err
		}
		if err := requireProjectAccess(tx, existing.ProjectID, accountID, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&value, "id = ? AND project_id = ?", documentID, existing.ProjectID).Error; err != nil {
			return err
		}
		updates := map[string]any{}
		if title != nil && value.Kind == store.DocumentKindDocument {
			return errCollaborativeTitleRequired
		}
		if title != nil {
			normalized, err := normalizeTitle(Field[string]{Present: true, Value: *title}, value.Kind)
			if err != nil {
				return err
			}
			updates["title"] = normalized
			value.Title = normalized
		}
		if cmd.ParentID.Present {
			if err := validateParent(tx, value.ProjectID, parentID, value.ID); err != nil {
				return err
			}
			updates["parent_id"] = parentID
			value.ParentID = parentID
			if !cmd.SortOrder.Present {
				sortOrder, err := nextSortOrder(tx, value.ProjectID, parentID)
				if err != nil {
					return err
				}
				updates["sort_order"] = sortOrder
				value.SortOrder = sortOrder
			}
		}
		if cmd.SortOrder.Present {
			updates["sort_order"] = cmd.SortOrder.Value
			value.SortOrder = cmd.SortOrder.Value
		}
		if len(updates) == 0 {
			return nil
		}
		now := s.now().UTC()
		updates["updated_by_user_id"] = accountID
		updates["updated_at"] = now
		result := tx.Model(&store.Document{}).Where("id = ? AND project_id = ?", value.ID, value.ProjectID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		value.UpdatedByUserID = accountID
		value.UpdatedAt = now
		if err := upsertDocumentContributor(tx, value.ID, accountID, now); err != nil {
			return err
		}
		return updateProjectTimestamp(tx, value.ProjectID, now)
	})
	if err != nil {
		return Document{}, mapMutationError(err)
	}
	if err := s.loadRelations(ctx, &value); err != nil {
		return Document{}, err
	}
	return newDocument(value), nil
}

func (s *Service) Move(ctx context.Context, cmd MoveCommand) (Document, error) {
	documentID, err := parseUUID(cmd.DocumentID, "文档 ID 格式错误")
	if err != nil {
		return Document{}, err
	}
	if !cmd.ParentID.Present {
		return Document{}, invalid("parent_id 是必填字段", nil)
	}
	parentID, err := normalizeParent(cmd.ParentID)
	if err != nil {
		return Document{}, err
	}
	if cmd.Index < 0 {
		return Document{}, invalid("index 必须是非负整数", nil)
	}
	accountID := strings.TrimSpace(cmd.AccountID)
	var value store.Document
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing store.Document
		if err := tx.First(&existing, "id = ?", documentID).Error; err != nil {
			return err
		}
		if err := requireProjectAccess(tx, existing.ProjectID, accountID, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&value, "id = ? AND project_id = ?", documentID, existing.ProjectID).Error; err != nil {
			return err
		}
		if err := validateParent(tx, value.ProjectID, parentID, value.ID); err != nil {
			return err
		}

		oldParentID := value.ParentID
		destination, err := siblingDocuments(tx, value.ProjectID, parentID, value.ID)
		if err != nil {
			return err
		}
		index := len(destination)
		if cmd.Index < int64(len(destination)) {
			index = int(cmd.Index)
		}
		destination = append(destination, store.Document{})
		copy(destination[index+1:], destination[index:])
		destination[index] = value

		now := s.now().UTC()
		if !sameDocumentParent(oldParentID, parentID) {
			source, err := siblingDocuments(tx, value.ProjectID, oldParentID, value.ID)
			if err != nil {
				return err
			}
			if err := updateSiblingOrder(tx, source, ""); err != nil {
				return err
			}
		}
		if err := updateSiblingOrder(tx, destination, value.ID); err != nil {
			return err
		}
		value.ParentID = parentID
		value.SortOrder = int64(index)
		value.UpdatedByUserID = accountID
		value.UpdatedAt = now
		if err := tx.Model(&store.Document{}).Where("id = ?", value.ID).Updates(map[string]any{
			"parent_id": parentID, "sort_order": value.SortOrder,
			"updated_by_user_id": accountID, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return updateProjectTimestamp(tx, value.ProjectID, now)
	})
	if err != nil {
		return Document{}, mapMutationError(err)
	}
	if err := s.loadRelations(ctx, &value); err != nil {
		return Document{}, err
	}
	return newDocument(value), nil
}

func (s *Service) Delete(ctx context.Context, cmd GetCommand) (DeleteResult, error) {
	documentID, err := parseUUID(cmd.DocumentID, "文档 ID 格式错误")
	if err != nil {
		return DeleteResult{}, err
	}
	accountID := strings.TrimSpace(cmd.AccountID)
	var deletedCount int64
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing store.Document
		if err := tx.First(&existing, "id = ?", documentID).Error; err != nil {
			return err
		}
		if err := requireProjectAccess(tx, existing.ProjectID, accountID, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&existing, "id = ? AND project_id = ?", documentID, existing.ProjectID).Error; err != nil {
			return err
		}
		ids, err := descendantIDs(tx, existing.ProjectID, existing.ID)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		result := tx.Model(&store.Document{}).Where("id IN ?", ids).Updates(map[string]any{
			"deleted_at": now, "updated_at": now, "updated_by_user_id": accountID,
		})
		if result.Error != nil {
			return result.Error
		}
		deletedCount = result.RowsAffected
		return updateProjectTimestamp(tx, existing.ProjectID, now)
	})
	if err != nil {
		return DeleteResult{}, mapMutationError(err)
	}
	return DeleteResult{DocumentID: documentID, DeletedCount: deletedCount}, nil
}

func (s *Service) loadRelations(ctx context.Context, value *store.Document) error {
	if err := preloadDocumentRelations(s.db.WithContext(ctx)).First(value, "id = ?", value.ID).Error; err != nil {
		return internalError(err)
	}
	return nil
}

func preloadDocumentRelations(db *gorm.DB) *gorm.DB {
	return db.
		Preload("CreatedByUser").
		Preload("UpdatedByUser").
		Preload("Contributors", func(query *gorm.DB) *gorm.DB {
			return query.Order("last_edited_at DESC").Order("user_id ASC")
		}).
		Preload("Contributors.User")
}

func upsertDocumentContributor(tx *gorm.DB, documentID, userID string, editedAt time.Time) error {
	value := store.DocumentContributor{
		DocumentID: documentID, UserID: userID,
		FirstEditedAt: editedAt, LastEditedAt: editedAt,
	}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "document_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{"last_edited_at": editedAt}),
	}).Create(&value).Error
}

func normalizeKind(field, documentTypeField Field[string]) (string, *string, error) {
	if !field.Present || field.Null {
		return "", nil, invalid("kind 是必填字段", nil)
	}
	kind := strings.TrimSpace(field.Value)
	switch kind {
	case KindFolder:
		if documentTypeField.Present && !documentTypeField.Null && strings.TrimSpace(documentTypeField.Value) != "" {
			return "", nil, invalid("目录不能设置 document_type", nil)
		}
		return kind, nil, nil
	case KindDocument:
		documentType := store.DocumentTypeDocument
		if documentTypeField.Present && !documentTypeField.Null {
			documentType = strings.TrimSpace(documentTypeField.Value)
		}
		switch documentType {
		case store.DocumentTypeDocument, store.DocumentTypeMarkdown:
		default:
			return "", nil, invalid("document_type 仅支持 document 或 markdown", nil)
		}
		return kind, &documentType, nil
	default:
		return "", nil, invalid("kind 仅支持 document 或 folder", nil)
	}
}

func normalizeTitle(field Field[string], kind string) (string, error) {
	if !field.Present || field.Null {
		return "", invalid("title 是必填字段", nil)
	}
	title := strings.TrimSpace(field.Value)
	if strings.IndexByte(title, 0) >= 0 {
		return "", invalid("title 不能包含空字符", nil)
	}
	if count := utf8.RuneCountInString(title); count < 1 || count > 500 {
		name := "文档标题"
		if kind == KindFolder {
			name = "目录名称"
		}
		return "", invalid(name+"长度必须为 1 到 500 个字符", nil)
	}
	return title, nil
}

func normalizeParent(field Field[string]) (*string, error) {
	if !field.Present || field.Null || strings.TrimSpace(field.Value) == "" {
		return nil, nil
	}
	value, err := parseUUID(field.Value, "父目录 ID 格式错误")
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func validateParent(tx *gorm.DB, projectID string, parentID *string, movingID string) error {
	if parentID == nil {
		return nil
	}
	currentID := *parentID
	seen := map[string]struct{}{}
	for depth := 0; depth < maximumHierarchyDepth; depth++ {
		if currentID == movingID {
			return errInvalidHierarchy
		}
		if _, exists := seen[currentID]; exists {
			return errInvalidHierarchy
		}
		seen[currentID] = struct{}{}
		var parent store.Document
		if err := tx.First(&parent, "id = ? AND project_id = ? AND kind = ?", currentID, projectID, store.DocumentKindFolder).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errInvalidHierarchy
			}
			return err
		}
		if parent.ParentID == nil {
			return nil
		}
		currentID = *parent.ParentID
	}
	return errInvalidHierarchy
}

func nextSortOrder(tx *gorm.DB, projectID string, parentID *string) (int64, error) {
	query := tx.Model(&store.Document{}).Where("project_id = ?", projectID)
	if parentID == nil {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	var maximum *int64
	if err := query.Select("MAX(sort_order)").Scan(&maximum).Error; err != nil {
		return 0, err
	}
	if maximum == nil {
		return 0, nil
	}
	return *maximum + 1, nil
}

func siblingDocuments(tx *gorm.DB, projectID string, parentID *string, excludedID string) ([]store.Document, error) {
	query := tx.Where("project_id = ? AND id <> ?", projectID, excludedID)
	if parentID == nil {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	var values []store.Document
	if err := query.Order("sort_order ASC").Order("id ASC").Find(&values).Error; err != nil {
		return nil, err
	}
	return values, nil
}

func updateSiblingOrder(tx *gorm.DB, values []store.Document, movingID string) error {
	for index, value := range values {
		if value.ID == movingID {
			continue
		}
		if value.SortOrder == int64(index) {
			continue
		}
		if err := tx.Model(&store.Document{}).Where("id = ?", value.ID).Update("sort_order", int64(index)).Error; err != nil {
			return err
		}
	}
	return nil
}

func sameDocumentParent(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func descendantIDs(tx *gorm.DB, projectID, rootID string) ([]string, error) {
	result := []string{rootID}
	seen := map[string]struct{}{rootID: {}}
	frontier := []string{rootID}
	for len(frontier) > 0 {
		var children []string
		if err := tx.Model(&store.Document{}).Where("project_id = ? AND parent_id IN ?", projectID, frontier).Pluck("id", &children).Error; err != nil {
			return nil, err
		}
		frontier = frontier[:0]
		for _, id := range children {
			if _, exists := seen[id]; exists {
				return nil, errInvalidHierarchy
			}
			seen[id] = struct{}{}
			result = append(result, id)
			frontier = append(frontier, id)
		}
	}
	return result, nil
}

func requireProjectAccess(db *gorm.DB, projectID, accountID string, lock bool) error {
	var value store.Project
	query := db.Where("id = ?", projectID).Where(projectAccessSQL(), projectAccessArgs(accountID)...)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	return query.First(&value).Error
}

func projectAccessSQL() string {
	return `(owner_user_id = ? OR EXISTS (SELECT 1 FROM project_groups pg JOIN conversations c ON c.id = pg.conversation_id JOIN conversation_members cm ON cm.conversation_id = c.id WHERE pg.project_id = projects.id AND c.kind = ? AND c.status = ? AND cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL))`
}

func projectAccessArgs(accountID string) []any {
	return []any{accountID, store.ConversationKindGroup, store.ConversationStatusActive, store.ConversationMemberTypeUser, accountID}
}

func updateProjectTimestamp(tx *gorm.DB, projectID string, now time.Time) error {
	result := tx.Model(&store.Project{}).Where("id = ?", projectID).Update("updated_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func parseUUID(raw, message string) (string, error) {
	value, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", invalid(message, err)
	}
	return value.String(), nil
}

func mapLookupError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return notFound(err)
	}
	return internalError(err)
}

func mapMutationError(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return notFound(err)
	case errors.Is(err, errInvalidHierarchy):
		return invalid("父目录不存在、属于其他项目或会形成循环", err)
	case errors.Is(err, errCollaborativeTitleRequired):
		return newError(CodeConflict, "文档标题必须通过协作服务修改", err)
	default:
		return internalError(err)
	}
}

func newDocument(value store.Document) Document {
	contributors := make([]UserSummary, 0, len(value.Contributors))
	for _, contributor := range value.Contributors {
		contributors = append(contributors, userSummary(contributor.User))
	}
	return Document{
		ID: value.ID, ProjectID: value.ProjectID, ParentID: value.ParentID, Kind: value.Kind,
		DocumentType: value.DocumentType, Title: value.Title, SortOrder: value.SortOrder, SchemaVersion: value.SchemaVersion,
		Creator: userSummary(value.CreatedByUser), UpdatedBy: userSummary(value.UpdatedByUser), Contributors: contributors,
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func userSummary(value store.User) UserSummary {
	return UserSummary{ID: value.ID, Name: value.Name, Nickname: value.Nickname, Avatar: value.Avatar}
}
