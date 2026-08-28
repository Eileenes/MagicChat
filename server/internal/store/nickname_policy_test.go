package store

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestUserNicknamePolicyMasksWithoutOverwritingStoredNickname(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:nickname-policy?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&AppSettings{}, &User{}); err != nil {
		t.Fatal(err)
	}
	if err := InstallUserNicknamePolicy(db); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	settings := AppSettings{
		ID: AppSettingsID, AppName: "即应", OrganizationName: "测试组织",
		AllowUserNicknameEditing: true, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&settings).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&AppSettings{}).Where("id = ?", AppSettingsID).
		Update("allow_user_nickname_editing", false).Error; err != nil {
		t.Fatal(err)
	}
	stored := User{
		ID: "00000000-0000-0000-0000-000000000001", Email: "alice@example.com",
		Name: "Alice Zhang", Nickname: "Alice", Avatar: DefaultUserAvatar,
		PasswordHash: "hash", Status: UserStatusActive, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&stored).Error; err != nil {
		t.Fatal(err)
	}

	var projected User
	if err := db.First(&projected, "id = ?", stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if projected.Nickname != stored.Name {
		t.Fatalf("projected nickname = %q, want real name %q", projected.Nickname, stored.Name)
	}
	var rawNickname string
	if err := db.Model(&User{}).Where("id = ?", stored.ID).Pluck("nickname", &rawNickname).Error; err != nil {
		t.Fatal(err)
	}
	if rawNickname != stored.Nickname {
		t.Fatalf("stored nickname = %q, want %q", rawNickname, stored.Nickname)
	}

	if err := db.Model(&AppSettings{}).Where("id = ?", AppSettingsID).
		Update("allow_user_nickname_editing", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&projected, "id = ?", stored.ID).Error; err != nil {
		t.Fatal(err)
	}
	if projected.Nickname != stored.Nickname {
		t.Fatalf("restored nickname = %q, want %q", projected.Nickname, stored.Nickname)
	}
}
