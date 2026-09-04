package httpapi

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/auth"
)

const (
	ctxUserID = "auth.userID"
	ctxRole   = "auth.role"
)

// bearerToken 从 Authorization 头提取 Bearer 令牌。
func bearerToken(header string) string {
	parts := strings.SplitN(header, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

// RequireAuth 校验访问令牌并注入用户上下文；失败统一 401。
func RequireAuth(manager *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := bearerToken(c.GetHeader("Authorization"))
		if raw == "" {
			failUnauthorized(c, "请先登录")
			c.Abort()
			return
		}
		userID, role, err := manager.Parse(raw)
		if err != nil {
			mapStoreError(c, err)
			c.Abort()
			return
		}
		c.Set(ctxUserID, userID)
		c.Set(ctxRole, role)
		c.Next()
	}
}

// RequireRole 在 RequireAuth 之后使用：校验角色（RBAC，如 admin）。
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		current, exists := c.Get(ctxRole)
		if !exists || current != role {
			fail(c, http.StatusForbidden, "没有权限执行该操作")
			c.Abort()
			return
		}
		c.Next()
	}
}

// limiter 极简内存限流：按 key 每窗口最大次数。
type limiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func newLimiter(window time.Duration, max int) *limiter {
	return &limiter{window: window, max: max, hits: make(map[string][]time.Time)}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	recent := l.hits[key][:0]
	for _, hit := range l.hits[key] {
		if hit.After(cutoff) {
			recent = append(recent, hit)
		}
	}
	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	return true
}

// RateLimit 对敏感接口按客户端 IP 限流。
func RateLimit(window time.Duration, max int) gin.HandlerFunc {
	bucket := newLimiter(window, max)
	return func(c *gin.Context) {
		if !bucket.allow(c.ClientIP() + "|" + c.FullPath()) {
			fail(c, 429, "操作过于频繁，请稍后再试")
			c.Abort()
			return
		}
		c.Next()
	}
}
