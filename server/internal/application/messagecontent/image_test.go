package messagecontent

import (
	"strings"
	"testing"
)

func TestNormalizeImageCaption(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		contentType string
		want        ImageCaption
		wantError   bool
	}{
		{name: "empty", content: "  ", contentType: "markdown", want: ImageCaption{}},
		{name: "default text", content: "  图片说明  ", want: ImageCaption{Content: "图片说明", ContentType: TypeText}},
		{name: "markdown", content: " **图片说明** ", contentType: "MARKDOWN", want: ImageCaption{Content: "**图片说明**", ContentType: TypeMarkdown}},
		{name: "unsupported type", content: "图片说明", contentType: "html", wantError: true},
		{name: "too long", content: strings.Repeat("图", maxTextLength+1), contentType: TypeText, wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeImageCaption(tt.content, tt.contentType)
			if (err != nil) != tt.wantError {
				t.Fatalf("NormalizeImageCaption() error = %v, wantError = %v", err, tt.wantError)
			}
			if got != tt.want {
				t.Fatalf("NormalizeImageCaption() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestImageMessageSummary(t *testing.T) {
	tests := []struct {
		name    string
		caption ImageCaption
		want    string
	}{
		{name: "empty", want: "[图片]"},
		{name: "text", caption: ImageCaption{Content: "图片说明", ContentType: TypeText}, want: "[图片] 图片说明"},
		{name: "markdown", caption: ImageCaption{Content: "**图片说明**", ContentType: TypeMarkdown}, want: "[图片] 图片说明"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ImageMessageSummary(tt.caption)
			if err != nil {
				t.Fatalf("ImageMessageSummary() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("ImageMessageSummary() = %q, want %q", got, tt.want)
			}
		})
	}
}
