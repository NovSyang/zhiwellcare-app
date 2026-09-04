-- =====================================================================
-- 智为康乐消费版后端初始表结构（PostgreSQL）
-- 幂等：全部使用 IF NOT EXISTS，可在每次服务启动时安全执行。
-- 消费版账号体系与未来医疗 APP 完全隔离（独立库/独立注册体系）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text NOT NULL UNIQUE,              -- 登录账号（中国大陆手机号）
    password_hash text NOT NULL,
    nickname      text NOT NULL DEFAULT '',
    avatar_url    text NOT NULL DEFAULT '',
    role          text NOT NULL DEFAULT 'user',       -- user | admin（RBAC 预留）
    status        smallint NOT NULL DEFAULT 1,        -- 1 正常 0 禁用
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL UNIQUE,                 -- sha256(明文刷新令牌)
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
