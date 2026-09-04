package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/auth"
	"zhiwellcare/backend/internal/config"
	"zhiwellcare/backend/internal/store"
)

// Deps 是路由装配所需的依赖。
type Deps struct {
	Config   *config.Config
	Store    store.Combined
	Manager  *auth.TokenManager
	WeChat   WeChatExchange // 微信 code2session；nil 时走本地 Mock
	// StartedAt 用于 /healthz
	StartedAt time.Time
}

// NewEngine 构建 Gin 引擎（测试可复用，不监听端口）。
func NewEngine(deps Deps) *gin.Engine {
	if !deps.Config.Debug {
		gin.SetMode(gin.ReleaseMode)
	}
	engine := gin.New()
	engine.Use(gin.Recovery(), RequestID(), SecurityHeaders())
	if deps.Config.LogRequests {
		engine.Use(AccessLog())
	}
	engine.Use(cors.New(cors.Config{
		// Capacitor(Android/iOS)、Tauri(Windows) 与网页来源的 scheme 不同
		// （http://localhost / capacitor://localhost / http://tauri.localhost），
		// 因此用自定义校验函数支持全部白名单来源。
		AllowOriginFunc: func(origin string) bool { return allowOrigin(deps.Config.CORSOrigins, origin) },
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	authAPI := &authHandler{store: deps.Store, manager: deps.Manager, refreshTTL: deps.Config.RefreshTokenTTL, exchange: deps.WeChat}
	userAPI := &userHandler{store: deps.Store}
	catalogAPI := &catalogHandler{store: deps.Store}
	adminUserAPI := &adminUserHandler{store: deps.Store}
	recordAPI := &recordHandler{store: deps.Store}

	// 健康检查（网页/壳探测用，无需鉴权）
	engine.GET("/healthz", func(c *gin.Context) {
		ok(c, gin.H{"status": "ok", "uptimeSeconds": int64(time.Since(deps.StartedAt).Seconds())})
	})

	v1 := engine.Group("/api/v1")
	{
		// 公开目录：APP 训练游戏中心读取（后端动态下发，支持灰度/上下架）
		catalog := v1.Group("/catalog")
		{
			catalog.GET("/devices", catalogAPI.publicDeviceModels)
			catalog.GET("/games", catalogAPI.publicGames)
		}
		v1.GET("/device/:modelId/games", catalogAPI.deviceGames)

		authGroup := v1.Group("/auth")
		{
			authGroup.POST("/register", RateLimit(time.Minute, 10), authAPI.register)
			authGroup.POST("/login", RateLimit(time.Minute, 20), authAPI.login)
			authGroup.POST("/refresh", authAPI.refresh)
			authGroup.POST("/logout", authAPI.logout)
			// 微信 UnionID 登录（真实凭据见 APP_WECHAT_APPID/SECRET；未配置走 Mock）
			authGroup.POST("/wechat/login", RateLimit(time.Minute, 20), authAPI.wechatLogin)
		}

		protected := v1.Group("", RequireAuth(deps.Manager))
		{
			protected.GET("/me", userAPI.me)
			protected.PATCH("/me", userAPI.updateMe)
			protected.PATCH("/me/phone", authAPI.bindPhone) // 微信用户补绑手机号
			protected.POST("/training/records", recordAPI.submit)
			protected.GET("/me/training-records", recordAPI.myRecords)
		}

		admin := v1.Group("/admin", RequireAuth(deps.Manager), RequireRole("admin"))
		{
			admin.GET("/stats/dashboard", adminUserAPI.dashboard)
			// 设备型号运营
			admin.GET("/devices", catalogAPI.adminListDevices)
			admin.POST("/devices", catalogAPI.adminCreateDevice)
			admin.PUT("/devices/:modelId", catalogAPI.adminUpdateDevice)
			admin.DELETE("/devices/:modelId", catalogAPI.adminDeleteDevice)
			admin.PATCH("/devices/:modelId/status", catalogAPI.adminSetDeviceStatus)
			// 游戏目录运营
			admin.GET("/games", catalogAPI.adminListGames)
			admin.POST("/games", catalogAPI.adminCreateGame)
			admin.PUT("/games/:gameId", catalogAPI.adminUpdateGame)
			admin.DELETE("/games/:gameId", catalogAPI.adminDeleteGame)
			admin.PATCH("/games/:gameId/status", catalogAPI.adminSetGameStatus)
			// 用户与训练记录
			admin.GET("/users", adminUserAPI.listUsers)
			admin.PATCH("/users/:id/status", adminUserAPI.setUserStatus)
			admin.GET("/training-records", recordAPI.adminList)
		}
	}

	engine.NoRoute(func(c *gin.Context) {
		fail(c, http.StatusNotFound, "接口不存在")
	})
	return engine
}

// allowOrigin 校验跨端来源：精确白名单 + 本地开发来源宽松放行。
func allowOrigin(allowed []string, origin string) bool {
	if origin == "" {
		return false
	}
	for _, item := range allowed {
		if item == "*" || origin == item {
			return true
		}
	}
	// 本地开发与原生壳默认放行（vite 任意端口 / Android WebView / Tauri 自定义 scheme）。
	if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
		return true
	}
	return strings.HasPrefix(origin, "capacitor://") || strings.HasPrefix(origin, "http://tauri.localhost")
}
