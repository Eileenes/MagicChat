package mobilepush

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
	ciphertextVersion = byte(1)
	fingerprintBytes  = 8
	ciphertextHeader  = 1 + fingerprintBytes
)

type encryptionKey struct {
	fingerprint [fingerprintBytes]byte
	aead        cipher.AEAD
}

type TokenCipher struct {
	current encryptionKey
	keys    map[string]encryptionKey
	hmacKey []byte
}

func NewTokenCipher(keys ...[]byte) (*TokenCipher, error) {
	if len(keys) == 0 {
		return nil, fmt.Errorf("at least one push credential encryption key is required")
	}
	result := &TokenCipher{keys: make(map[string]encryptionKey, len(keys))}
	for index, key := range keys {
		if len(key) != 32 {
			return nil, fmt.Errorf("push credential encryption key %d must contain 32 bytes", index)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(key)
		var fingerprint [fingerprintBytes]byte
		copy(fingerprint[:], digest[:fingerprintBytes])
		value := encryptionKey{fingerprint: fingerprint, aead: aead}
		result.keys[string(fingerprint[:])] = value
		if index == 0 {
			result.current = value
			result.hmacKey = append([]byte(nil), key...)
		}
	}
	return result, nil
}

func (c *TokenCipher) Encrypt(value string, associatedData []byte) ([]byte, error) {
	nonce := make([]byte, c.current.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	result := make([]byte, ciphertextHeader, ciphertextHeader+len(nonce)+len(value)+c.current.aead.Overhead())
	result[0] = ciphertextVersion
	copy(result[1:], c.current.fingerprint[:])
	result = append(result, nonce...)
	return c.current.aead.Seal(result, nonce, []byte(value), associatedData), nil
}

func (c *TokenCipher) NeedsRotation(value []byte) bool {
	return len(value) < ciphertextHeader || value[0] != ciphertextVersion ||
		subtle.ConstantTimeCompare(value[1:ciphertextHeader], c.current.fingerprint[:]) != 1
}

func (c *TokenCipher) Decrypt(value []byte, associatedData []byte) (string, error) {
	if len(value) < ciphertextHeader || value[0] != ciphertextVersion {
		return "", fmt.Errorf("push credential ciphertext format is unsupported")
	}
	key, ok := c.keys[string(value[1:ciphertextHeader])]
	if !ok {
		return "", fmt.Errorf("push credential encryption key is unavailable")
	}
	content := value[ciphertextHeader:]
	if len(content) < key.aead.NonceSize() {
		return "", fmt.Errorf("push credential ciphertext is truncated")
	}
	nonce := content[:key.aead.NonceSize()]
	plaintext, err := key.aead.Open(nil, nonce, content[key.aead.NonceSize():], associatedData)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func (c *TokenCipher) BlindIndex(value string) []byte {
	mac := hmac.New(sha256.New, c.hmacKey)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func randomToken() (string, error) {
	content := make([]byte, 32)
	if _, err := rand.Read(content); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(content), nil
}

func tokenHash(value string) []byte {
	result := sha256.Sum256([]byte(value))
	return result[:]
}
