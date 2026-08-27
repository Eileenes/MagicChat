package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
)

const (
	tokenBytes              = 32
	ciphertextFormatVersion = byte(1)
	keyFingerprintBytes     = 8
	ciphertextHeaderBytes   = 1 + keyFingerprintBytes
)

type cipherKey struct {
	fingerprint [keyFingerprintBytes]byte
	aead        cipher.AEAD
}

type TokenCipher struct {
	current       cipherKey
	keys          map[string]cipherKey
	blindIndexKey []byte
}

// NewTokenCipher creates a keyring. The first key encrypts new values and every
// key can decrypt values carrying its fingerprint, allowing rolling rotation.
func NewTokenCipher(keys ...[]byte) (*TokenCipher, error) {
	if len(keys) == 0 {
		return nil, fmt.Errorf("at least one data encryption key is required")
	}
	result := &TokenCipher{keys: make(map[string]cipherKey, len(keys))}
	for index, key := range keys {
		if len(key) != 32 {
			return nil, fmt.Errorf("data encryption key %d must contain exactly 32 bytes", index)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, fmt.Errorf("create aes cipher %d: %w", index, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("create gcm cipher %d: %w", index, err)
		}
		digest := sha256.Sum256(key)
		var fingerprint [keyFingerprintBytes]byte
		copy(fingerprint[:], digest[:keyFingerprintBytes])
		value := cipherKey{fingerprint: fingerprint, aead: aead}
		result.keys[string(fingerprint[:])] = value
		if index == 0 {
			result.current = value
			result.blindIndexKey = append([]byte(nil), key...)
		}
	}
	return result, nil
}

func (c *TokenCipher) Encrypt(plaintext string, associatedData []byte) ([]byte, error) {
	nonce := make([]byte, c.current.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate encryption nonce: %w", err)
	}
	result := make([]byte, ciphertextHeaderBytes, ciphertextHeaderBytes+len(nonce)+len(plaintext)+c.current.aead.Overhead())
	result[0] = ciphertextFormatVersion
	copy(result[1:], c.current.fingerprint[:])
	result = append(result, nonce...)
	return c.current.aead.Seal(result, nonce, []byte(plaintext), associatedData), nil
}

func (c *TokenCipher) NeedsRotation(ciphertext []byte) bool {
	return len(ciphertext) < ciphertextHeaderBytes ||
		ciphertext[0] != ciphertextFormatVersion ||
		subtle.ConstantTimeCompare(ciphertext[1:ciphertextHeaderBytes], c.current.fingerprint[:]) != 1
}

func (c *TokenCipher) Decrypt(ciphertext []byte, associatedData []byte) (string, error) {
	if len(ciphertext) < ciphertextHeaderBytes || ciphertext[0] != ciphertextFormatVersion {
		return "", fmt.Errorf("encrypted provider token has an unsupported format")
	}
	key, ok := c.keys[string(ciphertext[1:ciphertextHeaderBytes])]
	if !ok {
		return "", fmt.Errorf("encrypted provider token uses an unavailable key")
	}
	content := ciphertext[ciphertextHeaderBytes:]
	if len(content) < key.aead.NonceSize() {
		return "", fmt.Errorf("encrypted provider token is truncated")
	}
	nonce := content[:key.aead.NonceSize()]
	plaintext, err := key.aead.Open(nil, nonce, content[key.aead.NonceSize():], associatedData)
	if err != nil {
		return "", fmt.Errorf("decrypt provider token: %w", err)
	}
	return string(plaintext), nil
}

func (c *TokenCipher) BlindIndex(value string) []byte {
	mac := hmac.New(sha256.New, c.blindIndexKey)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func GenerateToken() (string, error) {
	content := make([]byte, tokenBytes)
	if _, err := rand.Read(content); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(content), nil
}

func HashToken(token string) []byte {
	value := sha256.Sum256([]byte(token))
	return value[:]
}

func MatchesToken(expected []byte, token string) bool {
	actual := HashToken(token)
	return len(expected) == len(actual) && subtle.ConstantTimeCompare(expected, actual) == 1
}
