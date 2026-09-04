// Package wechat 封装微信登录 code2session（UnionID 打通）。
// 未配置 AppID/Secret 时由 httpapi 使用 MockProvider，便于本地与单测。
package wechat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Session 是 code2session 的规范化结果。
type Session struct {
	OpenID  string
	UnionID *string
}

// Client 调用微信开放平台 code2session。
type Client struct {
	AppID     string
	Secret    string
	HTTP      *http.Client
	Endpoint  string
}

func NewClient(appID, secret string) *Client {
	return &Client{
		AppID:    appID,
		Secret:   secret,
		HTTP:     &http.Client{Timeout: 8 * time.Second},
		Endpoint: "https://api.weixin.qq.com/sns/jscode2session",
	}
}

// Code2Session 用登录 code 换 openid/unionid。
func (c *Client) Code2Session(ctx context.Context, code string) (*Session, error) {
	query := url.Values{}
	query.Set("appid", c.AppID)
	query.Set("secret", c.Secret)
	query.Set("js_code", code)
	query.Set("grant_type", "authorization_code")
	requestURL := c.Endpoint + "?" + query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		OpenID     string `json:"openid"`
		SessionKey string `json:"session_key"`
		UnionID    string `json:"unionid"`
		ErrCode    int    `json:"errcode"`
		ErrMsg     string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.ErrCode != 0 || result.OpenID == "" {
		return nil, fmt.Errorf("微信登录失败：%s (%d)", result.ErrMsg, result.ErrCode)
	}
	session := &Session{OpenID: result.OpenID}
	if result.UnionID != "" {
		session.UnionID = &result.UnionID
	}
	return session, nil
}

// Mock 是不配微信凭据时使用的本地可测 provider。
func Mock(ctx context.Context, code string) (*Session, error) {
	openid := "mock-openid-" + code
	unionid := "mock-union-" + code
	if len(code) >= 3 && code[:3] == "fx-" {
		// 前缀 fx- 表示模拟“同开放平台不同小程序”，验证 UnionID 合并。
		return &Session{OpenID: openid + "-b", UnionID: &unionid}, nil
	}
	return &Session{OpenID: openid, UnionID: &unionid}, nil
}
