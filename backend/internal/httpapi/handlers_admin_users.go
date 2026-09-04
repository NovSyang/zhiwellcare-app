package httpapi

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/model"
	"zhiwellcare/backend/internal/store"
)

type adminUserHandler struct{ store store.Combined }

// adminUser 是后台可见用户（管理员场景保留完整手机号）。
type adminUser struct {
	ID           string     `json:"id"`
	Phone        string     `json:"phone"`
	Nickname     string     `json:"nickname"`
	Role         string     `json:"role"`
	Status       int        `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
}

func toAdminUser(user *model.User) adminUser {
	return adminUser{
		ID:          user.ID,
		Phone:       user.Phone,
		Nickname:    user.Nickname,
		Role:        user.Role,
		Status:      user.Status,
		CreatedAt:   user.CreatedAt,
		LastLoginAt: user.LastLoginAt,
	}
}

// listUsers GET /api/v1/admin/users?keyword=&status=&page=&pageSize=
func (h *adminUserHandler) listUsers(c *gin.Context) {
	keyword := c.Query("keyword")
	status := -1
	if raw := c.Query("status"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			failBadRequest(c, "status 参数无效")
			return
		}
		status = value
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	items, total, err := h.store.ListUsers(c, keyword, status, page, size)
	if err != nil {
		mapStoreError(c, err)
		return
	}
	result := make([]adminUser, 0, len(items))
	for _, user := range items {
		copyUser := user
		result = append(result, toAdminUser(&copyUser))
	}
	ok(c, gin.H{"items": result, "total": total})
}

// setUserStatus PATCH /api/v1/admin/users/:id/status {status:1|0}
func (h *adminUserHandler) setUserStatus(c *gin.Context) {
	operatorID, _ := c.Get(ctxUserID)
	targetID := c.Param("id")
	var req struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (req.Status != 0 && req.Status != 1) {
		failBadRequest(c, "状态只能为 0（禁用）或 1（启用）")
		return
	}
	if operatorID == targetID {
		fail(c, 400, "不能停用当前登录账号")
		return
	}
	if err := h.store.SetUserStatus(c, targetID, req.Status); err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, gin.H{"id": targetID, "status": req.Status})
}

// dashboard GET /api/v1/admin/stats/dashboard
func (h *adminUserHandler) dashboard(c *gin.Context) {
	stats, err := h.store.DashboardStats(c)
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, stats)
}
