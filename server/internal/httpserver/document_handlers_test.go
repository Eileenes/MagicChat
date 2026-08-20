package httpserver

import (
	"net/http"
	"testing"
	"time"

	"app/internal/store"
)

func TestHTTPDocumentCRUDLifecycle(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Date(2026, 8, 5, 9, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "http-document-owner@example.com", "Document Owner", store.UserStatusActive, now)
	project := insertProjectFixture(t, db, projectFixtureInput{Owner: owner, Name: "Documents", UpdatedAt: now})
	cookie := loginAsUser(t, server, owner.Email)
	collectionPath := "/api/client/projects/" + project.ID + "/documents"

	response, body := postJSON(t, server, collectionPath, map[string]any{
		"kind": "folder", "title": "产品资料",
	}, cookie)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create folder status = %d, body = %#v", response.StatusCode, body)
	}
	folder := requireDocumentResponseData(t, body)
	if folder["kind"] != "folder" || folder["document_type"] != nil || folder["title"] != "产品资料" {
		t.Fatalf("folder = %#v", folder)
	}

	response, body = postJSON(t, server, collectionPath, map[string]any{
		"kind": "document", "title": "产品需求文档", "parent_id": folder["id"],
	}, cookie)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("create document status = %d, body = %#v", response.StatusCode, body)
	}
	document := requireDocumentResponseData(t, body)
	if document["document_type"] != "document" || document["parent_id"] != folder["id"] || document["contributor_count"] != float64(1) {
		t.Fatalf("document = %#v", document)
	}
	if contributors, ok := document["contributors"].([]any); !ok || len(contributors) != 1 {
		t.Fatalf("contributors = %#v", document["contributors"])
	}

	response, body = getJSON(t, server, collectionPath, cookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d, body = %#v", response.StatusCode, body)
	}
	listData := requireDocumentResponseData(t, body)
	documents, ok := listData["documents"].([]any)
	if !ok || len(documents) != 2 {
		t.Fatalf("documents = %#v", listData["documents"])
	}

	documentPath := "/api/client/documents/" + document["id"].(string)
	response, body = postJSON(t, server, documentPath+"/move", map[string]any{
		"parent_id": nil, "index": 3,
	}, cookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("update status = %d, body = %#v", response.StatusCode, body)
	}
	updated := requireDocumentResponseData(t, body)
	if updated["title"] != "产品需求文档" || updated["parent_id"] != nil || updated["sort_order"] != float64(1) {
		t.Fatalf("updated = %#v", updated)
	}

	response, body = getJSON(t, server, documentPath, cookie)
	if response.StatusCode != http.StatusOK || requireDocumentResponseData(t, body)["title"] != "产品需求文档" {
		t.Fatalf("get status = %d, body = %#v", response.StatusCode, body)
	}

	folderPath := "/api/client/documents/" + folder["id"].(string)
	response, body = requestJSON(t, server, http.MethodDelete, folderPath, map[string]any{}, cookie)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d, body = %#v", response.StatusCode, body)
	}
	deleted := requireDocumentResponseData(t, body)
	if deleted["document_id"] != folder["id"] || deleted["deleted_count"] != float64(1) {
		t.Fatalf("deleted = %#v", deleted)
	}

	response, body = getJSON(t, server, folderPath, cookie)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("get deleted status = %d, body = %#v", response.StatusCode, body)
	}
}

func TestHTTPDocumentCreateRejectsUnsupportedTypeAndInaccessibleProject(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Date(2026, 8, 5, 9, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "http-document-private-owner@example.com", "Owner", store.UserStatusActive, now)
	outsider := insertTestUser(t, db, "http-document-outsider@example.com", "Outsider", store.UserStatusActive, now)
	project := insertProjectFixture(t, db, projectFixtureInput{Owner: owner, Name: "Private documents", UpdatedAt: now})
	ownerCookie := loginAsUser(t, server, owner.Email)
	outsiderCookie := loginAsUser(t, server, outsider.Email)
	path := "/api/client/projects/" + project.ID + "/documents"

	response, body := postJSON(t, server, path, map[string]any{"kind": "markdown", "title": "Unsupported"}, ownerCookie)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unsupported status = %d, body = %#v", response.StatusCode, body)
	}

	response, body = postJSON(t, server, path, map[string]any{
		"kind": "document", "document_type": "markdown", "title": "开发说明",
	}, ownerCookie)
	if response.StatusCode != http.StatusCreated || requireDocumentResponseData(t, body)["document_type"] != "markdown" {
		t.Fatalf("markdown status = %d, body = %#v", response.StatusCode, body)
	}

	response, body = postJSON(t, server, path, map[string]any{
		"kind": "document", "document_type": "spreadsheet", "title": "Unsupported type",
	}, ownerCookie)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unsupported document type status = %d, body = %#v", response.StatusCode, body)
	}

	response, body = postJSON(t, server, path, map[string]any{"kind": "document", "title": "Hidden"}, outsiderCookie)
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider status = %d, body = %#v", response.StatusCode, body)
	}
}

func requireDocumentResponseData(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("response data = %#v", body["data"])
	}
	return data
}
