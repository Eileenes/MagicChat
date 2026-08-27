package secure

import (
	"bytes"
	"testing"
)

func TestTokenCipherRoundTripAndAssociatedData(t *testing.T) {
	cipher, err := NewTokenCipher(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatalf("NewTokenCipher() error = %v", err)
	}
	ciphertext, err := cipher.Encrypt("provider-token", []byte("installation-1"))
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}
	plaintext, err := cipher.Decrypt(ciphertext, []byte("installation-1"))
	if err != nil || plaintext != "provider-token" {
		t.Fatalf("Decrypt() = %q, %v", plaintext, err)
	}
	if _, err := cipher.Decrypt(ciphertext, []byte("installation-2")); err == nil {
		t.Fatal("Decrypt() with different associated data succeeded")
	}
}

func TestTokenCipherReadsPreviousRotationKey(t *testing.T) {
	oldKey := bytes.Repeat([]byte{1}, 32)
	newKey := bytes.Repeat([]byte{2}, 32)
	oldCipher, err := NewTokenCipher(oldKey)
	if err != nil {
		t.Fatalf("create old cipher: %v", err)
	}
	ciphertext, err := oldCipher.Encrypt("old-provider-token", []byte("installation-1"))
	if err != nil {
		t.Fatalf("encrypt with old key: %v", err)
	}
	rotatedCipher, err := NewTokenCipher(newKey, oldKey)
	if err != nil {
		t.Fatalf("create rotated cipher: %v", err)
	}
	if !rotatedCipher.NeedsRotation(ciphertext) {
		t.Fatal("ciphertext written with the previous key does not request rotation")
	}
	plaintext, err := rotatedCipher.Decrypt(ciphertext, []byte("installation-1"))
	if err != nil || plaintext != "old-provider-token" {
		t.Fatalf("decrypt with previous key = %q, %v", plaintext, err)
	}
	newCiphertext, err := rotatedCipher.Encrypt("new-provider-token", []byte("installation-1"))
	if err != nil {
		t.Fatalf("encrypt with current key: %v", err)
	}
	if rotatedCipher.NeedsRotation(newCiphertext) {
		t.Fatal("ciphertext written with the current key requests rotation")
	}
	if _, err := oldCipher.Decrypt(newCiphertext, []byte("installation-1")); err == nil {
		t.Fatal("old-only keyring decrypted ciphertext written with new key")
	}
}

func TestBlindIndexIsKeyedAndDeterministic(t *testing.T) {
	firstCipher, _ := NewTokenCipher(bytes.Repeat([]byte{3}, 32))
	secondCipher, _ := NewTokenCipher(bytes.Repeat([]byte{4}, 32))
	first := firstCipher.BlindIndex("203.0.113.10")
	if !bytes.Equal(first, firstCipher.BlindIndex("203.0.113.10")) {
		t.Fatal("blind index is not deterministic")
	}
	if bytes.Equal(first, secondCipher.BlindIndex("203.0.113.10")) || bytes.Equal(first, HashToken("203.0.113.10")) {
		t.Fatal("blind index is not keyed")
	}
}

func TestGeneratedTokensAreStrongAndDistinct(t *testing.T) {
	first, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	second, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}
	if len(first) < 40 || first == second {
		t.Fatalf("generated tokens have unexpected values: %q, %q", first, second)
	}
	if !MatchesToken(HashToken(first), first) || MatchesToken(HashToken(first), second) {
		t.Fatal("token hash matching returned an unexpected result")
	}
}
