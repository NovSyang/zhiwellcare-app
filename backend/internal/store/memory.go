package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
	"time"

	"zhiwellcare/backend/internal/model"
)

// Memory 是 PostgreSQL 的演示/测试替身：结构等价、进程内存储。
type Memory struct {
	mu        sync.RWMutex
	users     map[string]*model.User // key: phone
	byID      map[string]*model.User // key: user id
	tokens    map[string]*model.RefreshTokenRow
	nextToken int64
	// 目录运营 / 训练摘要 / OAuth（演示模式支持后台接口联调）
	devices    map[string]*model.DeviceModel
	games      map[string]*model.GameCatalogItem
	records    []model.TrainingSummary
	nextRecord int64
	oauth      map[string]string // provider|openid → userID
	oauthUnion map[string]string // provider|unionid → userID
}

func NewMemory() *Memory {
	return &Memory{
		users:      make(map[string]*model.User),
		byID:       make(map[string]*model.User),
		tokens:     make(map[string]*model.RefreshTokenRow),
		devices:    make(map[string]*model.DeviceModel),
		games:      make(map[string]*model.GameCatalogItem),
		oauth:      make(map[string]string),
		oauthUnion: make(map[string]string),
	}
}

func (m *Memory) CreateUser(ctx context.Context, params CreateUserParams) (*model.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.users[params.Phone]; exists {
		return nil, ErrPhoneExists
	}
	raw := sha256.Sum256([]byte(params.Phone + time.Now().String()))
	user := &model.User{
		ID:           hex.EncodeToString(raw[:12]),
		Phone:        params.Phone,
		PasswordHash: params.PasswordHash,
		Nickname:     params.Nickname,
		Role:         "user",
		Status:       1,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	m.users[user.Phone] = user
	m.byID[user.ID] = user
	return user, nil
}

func (m *Memory) GetUserByPhone(_ context.Context, phone string) (*model.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if user := m.users[phone]; user != nil {
		return cloneUser(user), nil
	}
	return nil, ErrUserNotFound
}

func (m *Memory) GetUserByID(_ context.Context, id string) (*model.User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if user := m.byID[id]; user != nil {
		return cloneUser(user), nil
	}
	return nil, ErrUserNotFound
}

func (m *Memory) UpdateNickname(_ context.Context, id, nickname string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user := m.byID[id]
	if user == nil {
		return ErrUserNotFound
	}
	user.Nickname = nickname
	user.UpdatedAt = time.Now()
	return nil
}

func (m *Memory) TouchLastLogin(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user := m.byID[id]
	if user == nil {
		return ErrUserNotFound
	}
	now := time.Now()
	user.LastLoginAt = &now
	user.UpdatedAt = now
	return nil
}

func (m *Memory) ListUsers(_ context.Context, keyword string, status, page, pageSize int) ([]model.User, int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var matched []model.User
	for _, user := range m.users {
		if status >= 0 && user.Status != status {
			continue
		}
		if keyword != "" && !strings.Contains(user.Phone, keyword) && !strings.Contains(user.Nickname, keyword) {
			continue
		}
		matched = append(matched, *user)
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].CreatedAt.After(matched[j].CreatedAt) })
	page, pageSize = normalizePage(page, pageSize)
	start := (page - 1) * pageSize
	if start > len(matched) {
		start = len(matched)
	}
	end := start + pageSize
	if end > len(matched) {
		end = len(matched)
	}
	return matched[start:end], int64(len(matched)), nil
}

func (m *Memory) SetUserStatus(_ context.Context, id string, status int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user := m.byID[id]
	if user == nil {
		return ErrUserNotFound
	}
	user.Status = status
	user.UpdatedAt = time.Now()
	return nil
}

func (m *Memory) SetUserRole(_ context.Context, id, role string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user := m.byID[id]
	if user == nil {
		return ErrUserNotFound
	}
	user.Role = role
	user.UpdatedAt = time.Now()
	return nil
}

func (m *Memory) Save(_ context.Context, userID, tokenHash string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextToken++
	m.tokens[tokenHash] = &model.RefreshTokenRow{
		ID:        m.nextToken,
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}
	return nil
}

func (m *Memory) FindByHash(_ context.Context, tokenHash string) (*model.RefreshTokenRow, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	row := m.tokens[tokenHash]
	if row == nil {
		return nil, ErrTokenNotFound
	}
	copyRow := *row
	return &copyRow, nil
}

func (m *Memory) Revoke(_ context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.tokens[tokenHash]
	if row == nil {
		return ErrTokenNotFound
	}
	now := time.Now()
	row.RevokedAt = &now
	return nil
}

func cloneUser(user *model.User) *model.User {
	copy := *user
	return &copy
}

// Ensure Memory 实现全部接口。
var _ Combined = (*Memory)(nil)
