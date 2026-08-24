package client

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"app/internal/application/document"

	"github.com/labstack/echo/v4"
)

type DocumentAPI struct {
	documents document.ClientService
}

type documentOptionalString struct {
	Present bool
	Null    bool
	Value   string
}

type documentOptionalInt64 struct {
	Present bool
	Null    bool
	Value   int64
}

type createDocumentRequest struct {
	Kind         documentOptionalString `json:"kind" swaggertype:"string" enums:"document,folder" binding:"required"`
	DocumentType documentOptionalString `json:"document_type" swaggertype:"string" enums:"document,markdown" extensions:"x-nullable"`
	Title        documentOptionalString `json:"title" swaggertype:"string" binding:"required"`
	ParentID     documentOptionalString `json:"parent_id" swaggertype:"string" extensions:"x-nullable"`
}

type updateDocumentRequest struct {
	Title     documentOptionalString `json:"title" swaggertype:"string"`
	ParentID  documentOptionalString `json:"parent_id" swaggertype:"string" extensions:"x-nullable"`
	SortOrder documentOptionalInt64  `json:"sort_order" swaggertype:"integer" format:"int64"`
}

type moveDocumentRequest struct {
	ParentID documentOptionalString `json:"parent_id" swaggertype:"string" extensions:"x-nullable" binding:"required"`
	Index    documentOptionalInt64  `json:"index" swaggertype:"integer" format:"int64" binding:"required"`
}

type documentResponse struct {
	ID               string                `json:"id"`
	ProjectID        string                `json:"project_id"`
	ParentID         *string               `json:"parent_id" extensions:"x-nullable"`
	Kind             string                `json:"kind" enums:"document,folder"`
	DocumentType     *string               `json:"document_type" extensions:"x-nullable"`
	Title            string                `json:"title"`
	SortOrder        int64                 `json:"sort_order"`
	SchemaVersion    int                   `json:"schema_version"`
	Creator          projectUserResponse   `json:"creator"`
	UpdatedBy        projectUserResponse   `json:"updated_by"`
	Contributors     []projectUserResponse `json:"contributors"`
	ContributorCount int                   `json:"contributor_count"`
	CreatedAt        time.Time             `json:"created_at"`
	UpdatedAt        time.Time             `json:"updated_at"`
}

type documentListResponse struct {
	Documents []documentResponse `json:"documents"`
}

type deleteDocumentResponse struct {
	DocumentID   string `json:"document_id"`
	DeletedCount int64  `json:"deleted_count"`
}

func NewDocumentAPI(documents document.ClientService) *DocumentAPI {
	return &DocumentAPI{documents: documents}
}

func (a *DocumentAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/projects/:project_id/documents", a.list)
	group.POST("/projects/:project_id/documents", a.create)
	group.GET("/documents/:document_id", a.get)
	group.PATCH("/documents/:document_id", a.update)
	group.POST("/documents/:document_id/move", a.move)
	group.DELETE("/documents/:document_id", a.delete)
}

// list godoc
//
// @Summary 列出项目文档
// @Description 返回项目内未删除的文档和目录节点，前端可根据 parent_id 构建目录树。
// @Tags 客户端文档
// @Produce json
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=documentListResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/documents [get]
func (a *DocumentAPI) list(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	values, err := a.documents.List(c.Request().Context(), document.ListCommand{
		AccountID: current.ID, ProjectID: c.Param("project_id"),
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	result := make([]documentResponse, 0, len(values))
	for _, value := range values {
		result = append(result, newDocumentResponse(value))
	}
	return writeSuccess(c, http.StatusOK, documentListResponse{Documents: result})
}

// create godoc
//
// @Summary 创建文档或目录
// @Description 在项目根目录或指定父目录下创建富文本文档、Markdown 文档或目录；document_type 省略时默认为 document。
// @Tags 客户端文档
// @Accept json
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param body body createDocumentRequest true "文档信息"
// @Success 201 {object} successEnvelope{data=documentResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/documents [post]
func (a *DocumentAPI) create(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	var req createDocumentRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(document.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.documents.Create(c.Request().Context(), document.CreateCommand{
		AccountID:    current.ID,
		ProjectID:    c.Param("project_id"),
		Kind:         documentStringField(req.Kind),
		DocumentType: documentStringField(req.DocumentType),
		Title:        documentStringField(req.Title),
		ParentID:     documentStringField(req.ParentID),
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, newDocumentResponse(value))
}

// get godoc
//
// @Summary 获取文档节点
// @Tags 客户端文档
// @Produce json
// @Param document_id path string true "文档 ID"
// @Success 200 {object} successEnvelope{data=documentResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/documents/{document_id} [get]
func (a *DocumentAPI) get(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	value, err := a.documents.Get(c.Request().Context(), document.GetCommand{
		AccountID: current.ID, DocumentID: c.Param("document_id"),
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newDocumentResponse(value))
}

// update godoc
//
// @Summary 更新文档节点
// @Description 重命名目录或更新节点字段；文档标题必须通过协作服务修改，移动操作推荐使用原子 move 接口。
// @Tags 客户端文档
// @Accept json
// @Produce json
// @Param document_id path string true "文档 ID"
// @Param body body updateDocumentRequest true "更新信息"
// @Success 200 {object} successEnvelope{data=documentResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/documents/{document_id} [patch]
func (a *DocumentAPI) update(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	var req updateDocumentRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		return writeFailure(c, http.StatusBadRequest, string(document.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.documents.Update(c.Request().Context(), document.UpdateCommand{
		AccountID:  current.ID,
		DocumentID: c.Param("document_id"),
		Title:      documentStringField(req.Title),
		ParentID:   documentStringField(req.ParentID),
		SortOrder:  documentInt64Field(req.SortOrder),
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newDocumentResponse(value))
}

// move godoc
//
// @Summary 移动文档节点
// @Description 在单个事务中移动文档或目录，并重新排列源目录与目标目录的同级节点。
// @Tags 客户端文档
// @Accept json
// @Produce json
// @Param document_id path string true "文档 ID"
// @Param body body moveDocumentRequest true "移动信息"
// @Success 200 {object} successEnvelope{data=documentResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/documents/{document_id}/move [post]
func (a *DocumentAPI) move(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	var req moveDocumentRequest
	if err := decodeStrictJSON(c, &req); err != nil || !req.ParentID.Present || !req.Index.Present {
		return writeFailure(c, http.StatusBadRequest, string(document.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.documents.Move(c.Request().Context(), document.MoveCommand{
		AccountID: current.ID, DocumentID: c.Param("document_id"),
		ParentID: documentStringField(req.ParentID), Index: req.Index.Value,
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newDocumentResponse(value))
}

// delete godoc
//
// @Summary 删除文档节点
// @Description 软删除文档；删除目录时递归软删除全部子节点。
// @Tags 客户端文档
// @Produce json
// @Param document_id path string true "文档 ID"
// @Success 200 {object} successEnvelope{data=deleteDocumentResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/documents/{document_id} [delete]
func (a *DocumentAPI) delete(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(document.CodeInternal), "服务端错误")
	}
	result, err := a.documents.Delete(c.Request().Context(), document.GetCommand{
		AccountID: current.ID, DocumentID: c.Param("document_id"),
	})
	if err != nil {
		return writeDocumentError(c, err)
	}
	return writeSuccess(c, http.StatusOK, deleteDocumentResponse{
		DocumentID: result.DocumentID, DeletedCount: result.DeletedCount,
	})
}

func (value *documentOptionalString) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(raw, &value.Value)
}

func (value *documentOptionalInt64) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(raw, &value.Value)
}

func documentStringField(value documentOptionalString) document.Field[string] {
	return document.Field[string]{Present: value.Present, Null: value.Null, Value: value.Value}
}

func documentInt64Field(value documentOptionalInt64) document.Field[int64] {
	return document.Field[int64]{Present: value.Present, Null: value.Null, Value: value.Value}
}

func newDocumentResponse(value document.Document) documentResponse {
	contributors := make([]projectUserResponse, 0, len(value.Contributors))
	for _, contributor := range value.Contributors {
		contributors = append(contributors, projectUserResponse{
			ID: contributor.ID, Name: contributor.Name, Nickname: contributor.Nickname, Avatar: contributor.Avatar,
		})
	}
	return documentResponse{
		ID: value.ID, ProjectID: value.ProjectID, ParentID: value.ParentID, Kind: value.Kind,
		DocumentType: value.DocumentType, Title: value.Title, SortOrder: value.SortOrder, SchemaVersion: value.SchemaVersion,
		Creator: documentUserResponse(value.Creator), UpdatedBy: documentUserResponse(value.UpdatedBy),
		Contributors: contributors, ContributorCount: len(contributors),
		CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
	}
}

func documentUserResponse(value document.UserSummary) projectUserResponse {
	return projectUserResponse{ID: value.ID, Name: value.Name, Nickname: value.Nickname, Avatar: value.Avatar}
}

func writeDocumentError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch document.ErrorCodeOf(err) {
	case document.CodeInvalidRequest:
		status = http.StatusBadRequest
	case document.CodeNotFound:
		status = http.StatusNotFound
	case document.CodeConflict:
		status = http.StatusConflict
	}
	return writeFailure(c, status, string(document.ErrorCodeOf(err)), document.ErrorMessage(err))
}
