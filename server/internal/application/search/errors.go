package search

import "errors"

type ErrorCode string

const (
	CodeInvalidRequest ErrorCode = "invalid_request"
	CodeTimeout        ErrorCode = "search_timeout"
	CodeInternal       ErrorCode = "internal_error"
)

type Error struct {
	Cause   error
	Code    ErrorCode
	Message string
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func ErrorCodeOf(err error) ErrorCode {
	var searchErr *Error
	if errors.As(err, &searchErr) {
		return searchErr.Code
	}
	return CodeInternal
}

func ErrorMessage(err error) string {
	var searchErr *Error
	if errors.As(err, &searchErr) && searchErr.Message != "" {
		return searchErr.Message
	}
	return "服务端错误"
}

func invalidRequest(message string, cause error) error {
	return &Error{Cause: cause, Code: CodeInvalidRequest, Message: message}
}

func internalError(cause error) error {
	return &Error{Cause: cause, Code: CodeInternal, Message: "服务端错误"}
}

func timeoutError(cause error) error {
	return &Error{Cause: cause, Code: CodeTimeout, Message: "搜索超时，请缩小搜索范围后重试"}
}
