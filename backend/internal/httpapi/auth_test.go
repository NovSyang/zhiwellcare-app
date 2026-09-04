package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/auth"
	"zhiwellcare/backend/internal/config"
	"zhiwellcare/backend/internal/model"
	"zhiwellcare/backend/internal/store"
)

func newTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	data := store.NewMemory()
	cfg := &config.Config{
		Addr:            ":0",
		JWTSecret:       "test-secret",
		AccessTokenTTL:  2 * time.Hour,
		RefreshTokenTTL: 30 * 24 * time.Hour,
		CORSOrigins:     []string{"http://localhost:1420"},
		LogRequests:     false,
	}
	manager := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL)
	return NewEngine(Deps{Config: cfg, Store: data, Manager: manager, StartedAt: time.Now()})
}

type envelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type authData struct {
	User   model.SafeUser  `json:"user"`
	Tokens model.TokenPair `json:"tokens"`
}

func doJSON(t *testing.T, engine http.Handler, method, path, token string, body any) (int, envelope) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	var result envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	return rec.Code, result
}

func decode[T any](t *testing.T, data json.RawMessage) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	return value
}

func TestAuthFullChain(t *testing.T) {
	engine := newTestEngine(t)
	phone := "13800138000"

	// 1) 注册（自动登录返回令牌）
	code, res := doJSON(t, engine, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"phone": phone, "password": "abc123", "nickname": "康康",
	})
	if code != http.StatusOK {
		t.Fatalf("注册失败: %d %s", code, res.Message)
	}
	registered := decode[authData](t, res.Data)
	if registered.User.PhoneMasked != "138****8000" {
		t.Fatalf("手机号脱敏异常: %s", registered.User.PhoneMasked)
	}

	// 2) 重复手机号 → 409
	code, res = doJSON(t, engine, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"phone": phone, "password": "abc123",
	})
	if code != http.StatusConflict {
		t.Fatalf("重复注册应 409，实际 %d", code)
	}

	// 3) 密码错误 → 401 且文案不暴露账号存在性
	code, res = doJSON(t, engine, http.MethodPost, "/api/v1/auth/login", "", map[string]any{
		"phone": phone, "password": "wrong-pass",
	})
	if code != http.StatusUnauthorized || res.Message != "手机号或密码不正确" {
		t.Fatalf("错误密码处理异常: %d %s", code, res.Message)
	}

	// 4) 正确登录
	code, res = doJSON(t, engine, http.MethodPost, "/api/v1/auth/login", "", map[string]any{
		"phone": phone, "password": "abc123",
	})
	if code != http.StatusOK {
		t.Fatalf("登录失败: %d %s", code, res.Message)
	}
	loginData := decode[authData](t, res.Data)
	access := loginData.Tokens.AccessToken
	refresh := loginData.Tokens.RefreshToken
	if access == "" || refresh == "" {
		t.Fatal("令牌为空")
	}

	// 5) GET /me 需要鉴权
	code, _ = doJSON(t, engine, http.MethodGet, "/api/v1/me", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("未带令牌访问 /me 应 401，实际 %d", code)
	}
	code, res = doJSON(t, engine, http.MethodGet, "/api/v1/me", access, nil)
	if code != http.StatusOK {
		t.Fatalf("me 失败: %d %s", code, res.Message)
	}
	me := decode[model.SafeUser](t, res.Data)
	if me.ID != registered.User.ID || me.Nickname != "康康" {
		t.Fatalf("me 返回异常: %+v", me)
	}

	// 6) PATCH /me 修改昵称
	code, res = doJSON(t, engine, http.MethodPatch, "/api/v1/me", access, map[string]any{"nickname": "阿康"})
	if code != http.StatusOK {
		t.Fatalf("改昵称失败: %d %s", code, res.Message)
	}
	if decode[model.SafeUser](t, res.Data).Nickname != "阿康" {
		t.Fatal("昵称未更新")
	}

	// 7) refresh 轮换：旧刷新令牌失效、新令牌可用
	code, res = doJSON(t, engine, http.MethodPost, "/api/v1/auth/refresh", "", map[string]any{"refreshToken": refresh})
	if code != http.StatusOK {
		t.Fatalf("刷新失败: %d %s", code, res.Message)
	}
	newPair := decode[authData](t, res.Data)
	code, _ = doJSON(t, engine, http.MethodPost, "/api/v1/auth/refresh", "", map[string]any{"refreshToken": refresh})
	if code != http.StatusUnauthorized {
		t.Fatalf("旧刷新令牌应已失效，实际 %d", code)
	}

	// 8) 登出后新刷新令牌不可再刷新
	code, res = doJSON(t, engine, http.MethodPost, "/api/v1/auth/logout", "", map[string]any{"refreshToken": newPair.Tokens.RefreshToken})
	if code != http.StatusOK {
		t.Fatalf("登出失败: %d %s", code, res.Message)
	}
	code, _ = doJSON(t, engine, http.MethodPost, "/api/v1/auth/refresh", "", map[string]any{"refreshToken": newPair.Tokens.RefreshToken})
	if code != http.StatusUnauthorized {
		t.Fatalf("登出后刷新令牌应失效，实际 %d", code)
	}
}

func TestAuthValidation(t *testing.T) {
	engine := newTestEngine(t)
	cases := []struct {
		name string
		body map[string]any
		code int
	}{
		{"非法手机号", map[string]any{"phone": "12345", "password": "abc123"}, http.StatusBadRequest},
		{"短密码", map[string]any{"phone": "13800138000", "password": "123"}, http.StatusBadRequest},
		{"缺参", map[string]any{}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, _ := doJSON(t, engine, http.MethodPost, "/api/v1/auth/register", "", tc.body)
			if code != tc.code {
				t.Fatalf("期望 %d 实际 %d", tc.code, code)
			}
		})
	}
}

func TestHealth(t *testing.T) {
	engine := newTestEngine(t)
	code, res := doJSON(t, engine, http.MethodGet, "/healthz", "", nil)
	if code != http.StatusOK || decode[map[string]any](t, res.Data)["status"] != "ok" {
		t.Fatalf("healthz 异常: %d", code)
	}
}
