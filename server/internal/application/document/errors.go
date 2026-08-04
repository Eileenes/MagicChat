package document

import "errors"

type ErrorCode string

const (
	CodeInvalidRequest ErrorCode = "invalid_request"
	CodeNotFound       ErrorCode = "not_found"
	CodeConflict       ErrorCode = "conflict"
	CodeInternal       ErrorCode = "internal_error"
)

type Error struct {
	Code    ErrorCode
	Message string
	Cause   error
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
	var documentErr *Error
	if errors.As(err, &documentErr) {
		return documentErr.Code
	}
	return CodeInternal
}

func ErrorMessage(err error) string {
	var documentErr *Error
	if errors.As(err, &documentErr) && documentErr.Message != "" {
		return documentErr.Message
	}
	return "服务端错误"
}

func newError(code ErrorCode, message string, cause error) error {
	return &Error{Code: code, Message: message, Cause: cause}
}

func invalid(message string, cause error) error {
	return newError(CodeInvalidRequest, message, cause)
}

func notFound(cause error) error {
	return newError(CodeNotFound, "文档不存在", cause)
}

func internalError(cause error) error {
	return newError(CodeInternal, "服务端错误", cause)
}
