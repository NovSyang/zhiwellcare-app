// Package model 定义领域模型与对外 DTO。
package model

import "time"

// User 用户记录（对应 users 表）。
type User struct {
	ID           string     `json:"id"`
	Phone        string     `json:"phone"`
	PasswordHash string     `json:"-"`
	Nickname     string     `json:"nickname"`
	AvatarURL    string     `json:"avatarUrl,omitempty"`
	Role         string     `json:"role"`
	Status       int        `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
}

// SafeUser 是返回给客户端的用户视图（不含密码哈希等敏感字段）。
type SafeUser struct {
	ID          string    `json:"id"`
	PhoneMasked string    `json:"phoneMasked"`
	Nickname    string    `json:"nickname"`
	AvatarURL   string    `json:"avatarUrl,omitempty"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (u *User) ToSafe() SafeUser {
	return SafeUser{
		ID:          u.ID,
		PhoneMasked: MaskPhone(u.Phone),
		Nickname:    u.Nickname,
		AvatarURL:   u.AvatarURL,
		Role:        u.Role,
		CreatedAt:   u.CreatedAt,
	}
}

// TokenPair 登录/注册/刷新返回的令牌对。
type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	// ExpiresInSeconds 访问令牌剩余秒数
	ExpiresInSeconds int64 `json:"expiresInSeconds"`
}

// RefreshTokenRow 刷新令牌持久化记录（仅存哈希）。
type RefreshTokenRow struct {
	ID        int64
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	RevokedAt *time.Time
	CreatedAt time.Time
}

// MaskPhone 手机号脱敏展示：138****8000。
func MaskPhone(phone string) string {
	if len(phone) != 11 {
		return phone
	}
	return phone[:3] + "****" + phone[7:]
}
