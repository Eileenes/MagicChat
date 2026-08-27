package store

import (
	"crypto/sha256"
	"encoding/binary"
	"strings"

	"gorm.io/gorm"
)

func LockMobilePushInstallation(tx *gorm.DB, installationID string) error {
	if tx.Dialector.Name() != "postgres" {
		return nil
	}
	digest := sha256.Sum256([]byte("mobile-push-installation\x00" + strings.TrimSpace(installationID)))
	key := int64(binary.BigEndian.Uint64(digest[:8]))
	return tx.Exec("SELECT pg_advisory_xact_lock(?)", key).Error
}
