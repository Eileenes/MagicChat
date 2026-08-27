package mobilepush

import "errors"

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func failure(code, message string) error { return &Error{Code: code, Message: message} }

func ErrorCodeOf(err error) string {
	var value *Error
	if errors.As(err, &value) {
		return value.Code
	}
	return "internal_error"
}

func ErrorMessage(err error) string {
	var value *Error
	if errors.As(err, &value) && value.Message != "" {
		return value.Message
	}
	return "服务端错误"
}
