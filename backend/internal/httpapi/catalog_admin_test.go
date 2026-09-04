package httpapi

import (
	"bytes"
	"context"
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

// buildEngineWithData 构造携带指定存储的引擎（测试可提升角色等）。
func buildEngineWithData(t *testing.T, data store.Combined) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{JWTSecret: "test-secret", AccessTokenTTL: 2 * time.Hour, RefreshTokenTTL: 24 * time.Hour}
	manager := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL)
	return NewEngine(Deps{Config: cfg, Store: data, Manager: manager, StartedAt: time.Now()})
}

func postBody(t *testing.T, engine *gin.Engine, path, token string, body any) (int, envelope) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
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

func registerAndLogin(t *testing.T, engine *gin.Engine, phone, password string) string {
	t.Helper()
	_, res := postBody(t, engine, "/api/v1/auth/register", "", map[string]any{"phone": phone, "password": password, "nickname": phone})
	if res.Code != 0 {
		t.Fatalf("注册失败: %s", res.Message)
	}
	return loginToken(t, engine, phone, password)
}

func loginToken(t *testing.T, engine *gin.Engine, phone, password string) string {
	t.Helper()
	_, res := postBody(t, engine, "/api/v1/auth/login", "", map[string]any{"phone": phone, "password": password})
	if res.Code != 0 {
		t.Fatalf("登录失败: %s", res.Message)
	}
	var data authData
	_ = json.Unmarshal(res.Data, &data)
	return data.Tokens.AccessToken
}

func patchBody(t *testing.T, engine *gin.Engine, path, token string, body any) (int, envelope) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPatch, path, bytes.NewReader(raw))
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

func TestAdminRBACAndCatalogOps(t *testing.T) {
	data := store.NewMemory()
	engine := buildEngineWithData(t, data)
	ctx := context.Background()

	userToken := registerAndLogin(t, engine, "13800000001", "pass123")
	adminToken := registerAndLogin(t, engine, "13800000002", "pass123")

	// 普通用户不可访问后台
	if code, _ := postBody(t, engine, "/api/v1/admin/devices", userToken, nil); code != http.StatusForbidden {
		t.Fatalf("普通用户访问 admin 应 403，实际 %d", code)
	}

	// 提升管理员（测试直接操作存储）
	adminUser, err := data.GetUserByPhone(ctx, "13800000002")
	if err != nil || adminUser == nil {
		t.Fatalf("查询管理员失败: %v", err)
	}
	if err := data.SetUserRole(ctx, adminUser.ID, "admin"); err != nil {
		t.Fatalf("提升角色失败: %v", err)
	}
	// 角色变更后需重新登录获取包含 admin 角色的新令牌。
	adminToken = loginToken(t, engine, "13800000002", "pass123")

	// 管理员创建设备型号 + 游戏
	code, res := postBody(t, engine, "/api/v1/admin/devices", adminToken, map[string]any{
		"modelId": "wobble-wrist-band", "name": "不倒翁手腕训练仪", "manufacturer": "智为康乐",
		"category": "wrist", "description": "姿态传感", "capabilityTags": []string{"posture-sensor"},
		"namePatterns": []string{"bt91"}, "protocol": "bs-bt91", "firmwareUpdatable": true, "icon": "⌚", "status": "on",
	})
	if code != http.StatusOK || res.Code != 0 {
		t.Fatalf("创建设备失败: %d %s", code, res.Message)
	}
	code, res = postBody(t, engine, "/api/v1/admin/games", adminToken, map[string]any{
		"gameId": "target-reach", "name": "四方挥腕挑战", "summary": "主动挥腕方向控制",
		"requiredTags": []string{"posture-sensor"}, "durationPresetsMin": []int{1, 3, 5},
		"status": "on", "categoryLabel": "腕部协调",
	})
	if code != http.StatusOK || res.Code != 0 {
		t.Fatalf("创建游戏失败: %d %s", code, res.Message)
	}

	// 公开目录只读返回上架项，且设备/游戏标签匹配正确
	publicGames := decode[[]model.GameCatalogItem](t, mustGet(t, engine, "/api/v1/catalog/games"))
	if len(publicGames) != 1 || publicGames[0].GameID != "target-reach" {
		t.Fatalf("公开游戏目录异常: %+v", publicGames)
	}
	matched := decode[[]model.GameCatalogItem](t, mustGet(t, engine, "/api/v1/device/wobble-wrist-band/games"))
	if len(matched) != 1 {
		t.Fatalf("设备可用游戏应命中 1 款，实际 %d", len(matched))
	}

	// 下架后公开目录消失
	if code, _ = patchBody(t, engine, "/api/v1/admin/games/target-reach/status", adminToken, map[string]any{"status": "off"}); code != http.StatusOK {
		t.Fatal("下架失败")
	}
	empty := decode[[]model.GameCatalogItem](t, mustGet(t, engine, "/api/v1/catalog/games"))
	if len(empty) != 0 {
		t.Fatalf("下架后公开目录应为空: %+v", empty)
	}

	// 用户管理：管理员可禁用普通用户
	userAcc, _ := data.GetUserByPhone(ctx, "13800000001")
	code, res = patchBody(t, engine, "/api/v1/admin/users/"+userAcc.ID+"/status", adminToken, map[string]any{"status": 0})
	if code != http.StatusOK {
		t.Fatalf("禁用用户失败: %s", res.Message)
	}
	users := decode[map[string]any](t, mustGetAuth(t, engine, "/api/v1/admin/users?keyword=13800000001", adminToken))
	if users["total"].(float64) != 1 {
		t.Fatalf("用户检索异常: %v", users)
	}
}

func TestTrainingReportAndDashboard(t *testing.T) {
	data := store.NewMemory()
	engine := buildEngineWithData(t, data)
	ctx := context.Background()

	adminToken := registerAndLogin(t, engine, "13800000011", "pass123")
	userToken := registerAndLogin(t, engine, "13800000012", "pass123")
	adminUser, _ := data.GetUserByPhone(ctx, "13800000011")
	_ = data.SetUserRole(ctx, adminUser.ID, "admin")
	adminToken = loginToken(t, engine, "13800000011", "pass123")

	code, res := postBody(t, engine, "/api/v1/training/records", userToken, map[string]any{
		"recordId": "rec-1", "gameId": "target-reach", "gameName": "四方挥腕挑战",
		"completedAt": time.Now().UnixMilli(),
		"device":      map[string]any{"modelId": "wobble-wrist-band", "modelName": "不倒翁手腕训练仪", "capabilityTags": []string{"posture-sensor"}},
		"statistics":  map[string]any{"successRate": 0.9, "total": 10},
	})
	if code != http.StatusOK || res.Code != 0 {
		t.Fatalf("上报训练失败: %d %s", code, res.Message)
	}

	myRecs := decode[map[string]any](t, mustGetAuth(t, engine, "/api/v1/me/training-records", userToken))
	if myRecs["total"].(float64) != 1 {
		t.Fatalf("个人云端记录异常: %v", myRecs)
	}
	adminRecs := decode[map[string]any](t, mustGetAuth(t, engine, "/api/v1/admin/training-records", adminToken))
	if adminRecs["total"].(float64) != 1 {
		t.Fatalf("后台记录查询异常: %v", adminRecs)
	}
	stats := decode[model.DashboardStats](t, mustGetAuth(t, engine, "/api/v1/admin/stats/dashboard", adminToken))
	if stats.TrainingRecs != 1 || stats.Users != 2 {
		t.Fatalf("仪表盘统计异常: %+v", stats)
	}
}

func TestWechatLoginMockAndBindPhone(t *testing.T) {
	data := store.NewMemory()
	engine := buildEngineWithData(t, data)

	// Mock 微信登录：同一 code 幂等返回同一账号
	code, res := postBody(t, engine, "/api/v1/auth/wechat/login", "", map[string]any{"code": "demo-abc", "nickname": "微信用户"})
	if code != http.StatusOK || res.Code != 0 {
		t.Fatalf("微信登录失败: %d %s", code, res.Message)
	}
	first := decode[wechatLoginResponse](t, res.Data)
	if !first.IsNewUser || !first.NeedsPhoneBind {
		t.Fatalf("首次微信登录应标记新用户且需绑手机: %+v", first)
	}
	code, res = postBody(t, engine, "/api/v1/auth/wechat/login", "", map[string]any{"code": "demo-abc"})
	second := decode[wechatLoginResponse](t, res.Data)
	if code != http.StatusOK || second.IsNewUser || second.User.ID != first.User.ID {
		t.Fatalf("二次微信登录应命中同一账号: %+v", second)
	}

	// 补绑手机号
	code, res = patchBody(t, engine, "/api/v1/me/phone", second.Tokens.AccessToken, map[string]any{"phone": "13800000021"})
	if code != http.StatusOK || res.Code != 0 {
		t.Fatalf("绑定手机号失败: %d %s", code, res.Message)
	}
	// 同一手机号密码注册 → 冲突
	code, res = postBody(t, engine, "/api/v1/auth/register", "", map[string]any{"phone": "13800000021", "password": "pass123"})
	if code != http.StatusConflict {
		t.Fatalf("重复绑定手机号应 409，实际 %d", code)
	}
	// 已绑手机后再次绑定 → 409
	code, _ = patchBody(t, engine, "/api/v1/me/phone", second.Tokens.AccessToken, map[string]any{"phone": "13800000022"})
	if code != http.StatusConflict {
		t.Fatalf("重复补绑应 409，实际 %d", code)
	}
}

func mustGet(t *testing.T, engine *gin.Engine, path string) json.RawMessage {
	t.Helper()
	return mustGetAuth(t, engine, path, "")
}

func mustGetAuth(t *testing.T, engine *gin.Engine, path, token string) json.RawMessage {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	var result envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s 失败: %d %s", path, rec.Code, result.Message)
	}
	return result.Data
}
