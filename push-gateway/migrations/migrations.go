package migrations

import "embed"

// Files contains every database migration required by push-gateway.
//
//go:embed *.sql
var Files embed.FS
