package store

import (
	"errors"
	"reflect"

	"gorm.io/gorm"
)

const userNicknamePolicyCallback = "dianbao:user_nickname_policy"

var userModelType = reflect.TypeOf(User{})

// InstallUserNicknamePolicy keeps stored nicknames intact while projecting the
// real name whenever administrators disable user nickname editing.
func InstallUserNicknamePolicy(db *gorm.DB) error {
	if db.Callback().Query().Get(userNicknamePolicyCallback) != nil {
		return nil
	}
	return db.Callback().Query().After("gorm:after_query").Register(userNicknamePolicyCallback, applyUserNicknamePolicy)
}

func applyUserNicknamePolicy(tx *gorm.DB) {
	if tx.Error != nil || tx.Statement == nil || tx.Statement.Dest == nil {
		return
	}
	users := make([]*User, 0)
	collectUsers(reflect.ValueOf(tx.Statement.Dest), &users, 0)
	if len(users) == 0 {
		return
	}

	var settings AppSettings
	err := tx.Session(&gorm.Session{NewDB: true}).
		Select("allow_user_nickname_editing").
		First(&settings, "id = ?", AppSettingsID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return
	}
	if err != nil {
		tx.AddError(err)
		return
	}
	if settings.AllowUserNicknameEditing {
		return
	}
	for _, user := range users {
		user.Nickname = user.Name
	}
}

func collectUsers(value reflect.Value, users *[]*User, depth int) {
	if !value.IsValid() || depth > 16 {
		return
	}
	for value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return
		}
		value = value.Elem()
	}
	if value.Type() == userModelType {
		if value.CanAddr() && value.Addr().CanInterface() {
			*users = append(*users, value.Addr().Interface().(*User))
		}
		return
	}
	switch value.Kind() {
	case reflect.Slice, reflect.Array:
		for index := 0; index < value.Len(); index++ {
			collectUsers(value.Index(index), users, depth+1)
		}
	case reflect.Struct:
		valueType := value.Type()
		for index := 0; index < value.NumField(); index++ {
			if valueType.Field(index).PkgPath == "" {
				collectUsers(value.Field(index), users, depth+1)
			}
		}
	}
}
