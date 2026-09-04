// Package config 从环境变量加载后端运行配置（支持 .env 文件，见 backend/.env.example）。
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	// Addr HTTP 监听地址，如 :8080
	Addr string
	// DBURL PostgreSQL 连接串；为空时回退到内置内存存储（演示模式）
	DBURL string
	// JWTSecret 访问令牌签名密钥；生产必须通过环境注入
	JWTSecret string
	// AccessTokenTTL 访问令牌有效期
	AccessTokenTTL time.Duration
	// RefreshTokenTTL 刷新令牌有效期
	RefreshTokenTTL time.Duration
	// CORSOrigins 允许的跨端来源（网页/Capacitor/Tauri）
	CORSOrigins []string
	// LogRequests 是否打印请求日志
	LogRequests bool
	// Debug 开启 Gin 调试模式（生产关闭）
	Debug bool
	// LogJSON 结构化 JSON 日志（slog）
	LogJSON bool
	// WeChatAppID / WeChatSecret 微信开放平台（未配置则登录走 Mock，仅联调用）
	WeChatAppID  string
	WeChatSecret string
	// AdminBootstrapPhone 启动时把该手机号用户提升为 admin（演示/初始化用，可留空）
	AdminBootstrapPhone string
}

func Load() (*Config, error) {
	cfg := &Config{
		Addr:                getEnv("APP_ADDR", ":8080"),
		DBURL:               os.Getenv("APP_DB_URL"),
		JWTSecret:           getEnv("APP_JWT_SECRET", "zhiwellcare-dev-secret-change-me"),
		AccessTokenTTL:      2 * time.Hour,
		RefreshTokenTTL:     30 * 24 * time.Hour,
		CORSOrigins:         splitList(getEnv("APP_CORS_ORIGINS", "http://localhost:1420,http://localhost:4173,http://tauri.localhost,capacitor://localhost,http://localhost")),
		LogRequests:         getEnv("APP_LOG_REQUESTS", "true") == "true",
		Debug:               getEnv("APP_DEBUG", "false") == "true",
		LogJSON:             getEnv("APP_LOG_JSON", "true") == "true",
		WeChatAppID:         os.Getenv("APP_WECHAT_APPID"),
		WeChatSecret:        os.Getenv("APP_WECHAT_SECRET"),
		AdminBootstrapPhone: os.Getenv("APP_ADMIN_BOOTSTRAP_PHONE"),
	}
	if ttl := os.Getenv("APP_ACCESS_TTL_MINUTES"); ttl != "" {
		minutes, err := parseMinutes(ttl)
		if err != nil {
			return nil, fmt.Errorf("APP_ACCESS_TTL_MINUTES 无效: %w", err)
		}
		cfg.AccessTokenTTL = time.Duration(minutes) * time.Minute
	}
	if cfg.DBURL == "" {
		fmt.Println("[config] APP_DB_URL 未配置 → 使用内存存储（演示模式；生产请配置 PostgreSQL）")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseMinutes(value string) (int, error) {
	var minutes int
	if _, err := fmt.Sscanf(value, "%d", &minutes); err != nil {
		return 0, err
	}
	return minutes, nil
}
