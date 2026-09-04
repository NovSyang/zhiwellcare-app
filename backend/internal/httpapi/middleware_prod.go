package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

const ctxRequestID = "http.requestID"

// RequestID 为每个请求生成 X-Request-ID（透传客户端已有值）。
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" {
			buffer := make([]byte, 8)
			if _, err := rand.Read(buffer); err == nil {
				id = hex.EncodeToString(buffer)
			} else {
				id = time.Now().Format("20060102150405")
			}
		}
		c.Set(ctxRequestID, id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}

// SecurityHeaders 基础 Web 安全响应头（CSP 交由部署层按端配置）。
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Next()
	}
}

// AccessLog 结构化访问日志（slog JSON），与 Gin 默认文本日志互斥使用。
func AccessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		requestID, _ := c.Get(ctxRequestID)
		slog.Info("http",
			"request_id", requestID,
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent(),
		)
	}
}
