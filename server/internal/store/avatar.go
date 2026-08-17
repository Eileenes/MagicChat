package store

import (
	crand "crypto/rand"
	"fmt"
	"math/big"
)

const builtinAvatarCount = 64

// RandomBuiltinAvatar returns a random builtin avatar path such as
// "/assets/avatars/builtin/07.webp". It falls back to DefaultUserAvatar when
// secure randomness is unavailable.
func RandomBuiltinAvatar() string {
	index, err := crand.Int(crand.Reader, big.NewInt(builtinAvatarCount))
	if err != nil {
		return DefaultUserAvatar
	}
	return fmt.Sprintf("/assets/avatars/builtin/%02d.webp", index.Int64()+1)
}
