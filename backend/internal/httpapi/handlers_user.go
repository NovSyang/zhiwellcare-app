package httpapi

import (
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/store"
)

type userHandler struct {
	store store.Combined
}

type updateMeRequest struct {
	Nickname string `json:"nickname"`
}

// me 返回当前登录用户资料（GET /api/v1/me）。
func (h *userHandler) me(c *gin.Context) {
	userID, _ := c.Get(ctxUserID)
	user, err := h.store.GetUserByID(c, userID.(string))
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, user.ToSafe())
}

// updateMe 更新昵称（PATCH /api/v1/me）。
func (h *userHandler) updateMe(c *gin.Context) {
	var req updateMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		failBadRequest(c, "请求参数格式不正确")
		return
	}
	req.Nickname = trimSpace(req.Nickname)
	if utf8.RuneCountInString(req.Nickname) == 0 {
		failBadRequest(c, "昵称不能为空")
		return
	}
	if utf8.RuneCountInString(req.Nickname) > 20 {
		failBadRequest(c, "昵称最长 20 个字符")
		return
	}
	userID, _ := c.Get(ctxUserID)
	if err := h.store.UpdateNickname(c, userID.(string), req.Nickname); err != nil {
		mapStoreError(c, err)
		return
	}
	user, err := h.store.GetUserByID(c, userID.(string))
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, user.ToSafe())
}
