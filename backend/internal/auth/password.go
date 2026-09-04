// Package auth 提供密码哈希与 JWT 访问令牌能力。
package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// ErrPasswordMismatch 表示密码校验失败（不区分用户不存在，避免账号枚举）。
var ErrPasswordMismatch = errors.New("密码不正确")

// HashPassword 使用 bcrypt 生成密码哈希。
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword 校验明文密码与哈希是否匹配。
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
