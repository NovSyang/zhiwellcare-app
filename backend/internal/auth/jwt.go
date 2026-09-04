package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenManager 签发/校验 JWT 访问令牌。
type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

// Claims 是访问令牌携带的自定义声明。
type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	return &TokenManager{secret: []byte(secret), ttl: ttl}
}

func (m *TokenManager) Issue(userID, role string) (token string, expiresInSeconds int64, err error) {
	now := time.Now()
	claims := Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
			Issuer:    "zhiwellcare",
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	if err != nil {
		return "", 0, err
	}
	return signed, int64(m.ttl.Seconds()), nil
}

var ErrInvalidToken = errors.New("令牌无效或已过期")

// Parse 校验访问令牌并返回用户 ID 与角色。
func (m *TokenManager) Parse(raw string) (userID, role string, err error) {
	parsed, err := jwt.ParseWithClaims(raw, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return "", "", ErrInvalidToken
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return "", "", ErrInvalidToken
	}
	if claims.Subject == "" {
		return "", "", ErrInvalidToken
	}
	return claims.Subject, claims.Role, nil
}

// NewRefreshSecret 生成 32 字节随机刷新令牌明文（64 位十六进制）。
func NewRefreshSecret() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

// HashRefreshToken 仅保存刷新令牌的 SHA-256 哈希，泄库不可重放。
func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
