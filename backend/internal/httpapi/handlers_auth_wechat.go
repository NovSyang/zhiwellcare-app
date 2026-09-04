package httpapi

import (
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"zhiwellcare/backend/internal/model"
	"zhiwellcare/backend/internal/store"
	"zhiwellcare/backend/internal/wechat"
)

type wechatLoginRequest struct {
	Code     string `json:"code"`
	Nickname string `json:"nickname"`
}

type wechatLoginResponse struct {
	User          model.SafeUser  `json:"user"`
	Tokens        model.TokenPair `json:"tokens"`
	IsNewUser     bool            `json:"isNewUser"`
	NeedsPhoneBind bool           `json:"needsPhoneBind"`
}

// wechatLogin 微信 UnionID 登录：code → session → 查找/创建账号。
func (h *authHandler) wechatLogin(c *gin.Context) {
	var req wechatLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		failBadRequest(c, "请求参数格式不正确")
		return
	}
	if len(req.Code) == 0 || len(req.Code) > 256 {
		failBadRequest(c, "微信登录 code 无效")
		return
	}
	exchange := h.exchange
	if exchange == nil {
		// 未配置微信凭据时使用本地 Mock（单测/联调用）。
		exchange = wechat.Mock
	}
	session, err := exchange(c, req.Code)
	if err != nil {
		fail(c, 401, "微信登录失败，请重试")
		return
	}
	nickname := req.Nickname
	if nickname == "" {
		nickname = "微信用户"
	}
	if utf8.RuneCountInString(nickname) > 20 {
		nickname = "微信用户"
	}
	user, created, err := h.store.GetOrCreateByOAuth(c, store.OAuthParams{
		Provider: "wechat",
		OpenID:   session.OpenID,
		UnionID:  session.UnionID,
		Nickname: nickname,
	})
	if err != nil {
		mapStoreError(c, err)
		return
	}
	if user.Status != 1 {
		fail(c, 403, "该账号已被停用，请联系客服")
		return
	}
	_ = h.store.TouchLastLogin(c, user.ID)
	tokens, err := h.issuePair(c, user)
	if err != nil {
		mapStoreError(c, err)
		return
	}
	safe := user.ToSafe()
	ok(c, wechatLoginResponse{
		User:           safe,
		Tokens:         *tokens,
		IsNewUser:      created,
		NeedsPhoneBind: user.Phone == "",
	})
}

// bindPhone 微信新用户补绑手机号（仅当前手机号为空时可绑）。
func (h *authHandler) bindPhone(c *gin.Context) {
	userIDValue, _ := c.Get(ctxUserID)
	userID := userIDValue.(string)
	var req struct {
		Phone string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		failBadRequest(c, "请求参数格式不正确")
		return
	}
	req.Phone = trimSpace(req.Phone)
	if !phonePattern.MatchString(req.Phone) {
		failBadRequest(c, "请输入正确的手机号")
		return
	}
	user, err := h.store.GetUserByID(c, userID)
	if err != nil {
		mapStoreError(c, err)
		return
	}
	if user.Phone != "" {
		fail(c, 409, "该账号已绑定手机号")
		return
	}
	if err := h.store.BindPhoneToUser(c, userID, req.Phone); err != nil {
		mapStoreError(c, err)
		return
	}
	updated, err := h.store.GetUserByID(c, userID)
	if err != nil {
		mapStoreError(c, err)
		return
	}
	ok(c, updated.ToSafe())
}
