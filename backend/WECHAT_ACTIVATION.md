# 微信 UnionID 登录 · 激活指南

## 一、能力边界（本仓库已实现）

- 后端接口：`POST /api/v1/auth/wechat/login`（`{code, nickname?}`）
  - 未配置 `APP_WECHAT_APPID/SECRET` 时走**本地 Mock**（`internal/wechat`），仅用于联调与单测，**不可上线**。
  - 配置后走真实 `code2session`：返回 `openid`（可能含 `unionid`），`oauth_identities` 表按
    `(provider='wechat', openid)` 唯一，`unionid` 用于打通同一开放平台下的多个应用账号。
- 首次登录自动建号（无手机号）：`data.needsPhoneBind=true`，前端引导补绑手机号
  `PATCH /api/v1/me/phone {phone}`（同一手机号已注册则 409）。
- 用户端「我的」页登录态、退出已接入同一账号体系。

## 二、上线前需准备的微信侧资质

1. **微信开放平台账号**（open.weixin.qq.com）并完成开发者认证；
2. 若同时支持「小程序 + 公众号/APP」多端打通 UnionID：
   - 小程序/公众号须**绑定同一开放平台账号**，并在其「管理中心」绑定应用；
   - UnionID 只有在这些绑定关系下才会返回；
3. 获取：
   - 小程序：`AppID + AppSecret`（mp.weixin.qq.com → 开发 → 开发设置）；
   - 或公众号/APP 对应的 `AppID/Secret`；
4. 配置合法域名：小程序后台「开发管理 → 开发设置 → 服务器域名」加入后端域名（request 合法域名），
   且必须是已备案 HTTPS 域名（正式 `game.zhiwellcare.com`）。

## 三、服务端启用步骤

```bash
# 1) 注入（密钥管理服务/容器环境变量，勿入库）
export APP_WECHAT_APPID=wx0000000000000000
export APP_WECHAT_SECRET=your_app_secret
# 2) 重启后端：日志出现「微信登录已启用」即为真实模式
```

## 四、前端（用户端）对接点

- 待接入前端一键登录按钮：小程序场景可直接调用 `wx.login()` 取 `code`；
  若为 APP/公众号内嵌网页，则走对应 JS-SDK/OAuth 拿 code；
- 拿到 `code` 后调用 `/auth/wechat/login`，落 `auth store` 令牌；
- 若 `needsPhoneBind=true` 弹出「绑定手机号」弹层（校验 CN 手机号）→ `PATCH /me/phone`。

## 五、安全与合规提示

- 生产必须配置真实 AppSecret；绝不把 `code` 之外的微信凭据传到前端；
- `code` 一次性有效，5 分钟内有效，勿缓存；
- 绑定手机号后账号即可同时用「微信快捷登录 / 手机号+密码登录」两种方式；消费版账号体系与未来医疗 APP 完全隔离。
