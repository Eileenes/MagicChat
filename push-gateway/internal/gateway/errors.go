package gateway

import "errors"

type Failure struct {
	Code    string
	Message string
}

func (f *Failure) Error() string { return f.Message }

func newFailure(code, message string) error {
	return &Failure{Code: code, Message: message}
}

func FailureOf(err error) (*Failure, bool) {
	var failure *Failure
	if !errors.As(err, &failure) {
		return nil, false
	}
	return failure, true
}
