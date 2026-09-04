-- =====================================================================
-- 智为康乐消费版 · 目录运营 / 训练摘要 / 微信 OAuth（002）
-- 幂等：全部 IF NOT EXISTS / 容错 ALTER。
-- =====================================================================

-- 手机号可空：微信 UnionID 用户注册后可再绑定手机号（绑定前 phone 为 NULL）
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- 设备型号目录（后台运营维护；APP 经公开接口读取，消费版纯主动设备）
CREATE TABLE IF NOT EXISTS device_models (
    model_id               text PRIMARY KEY,
    name                   text NOT NULL,
    manufacturer           text NOT NULL DEFAULT '智为康乐',
    category               text NOT NULL DEFAULT 'wrist',
    description            text NOT NULL DEFAULT '',
    capability_tags        text[] NOT NULL DEFAULT '{}',
    supported_handle_tags  text[] NOT NULL DEFAULT '{}',
    name_patterns          text[] NOT NULL DEFAULT '{}',
    protocol               text,
    min_app_version        text NOT NULL DEFAULT '0.1.0',
    firmware_updatable     boolean NOT NULL DEFAULT false,
    icon                   text NOT NULL DEFAULT '',
    status                 text NOT NULL DEFAULT 'on',        -- on | off
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

-- 游戏目录（后台运营维护；required_tags 驱动“设备能力标签 ⊇ 游戏所需标签”匹配）
CREATE TABLE IF NOT EXISTS game_catalog (
    game_id               text PRIMARY KEY,
    name                  text NOT NULL,
    summary               text NOT NULL DEFAULT '',
    required_tags         text[] NOT NULL DEFAULT '{}',
    duration_presets_min  int[] NOT NULL DEFAULT '{1,3,5}',
    resource_version      text NOT NULL DEFAULT '1.0.0',
    resource_url          text NOT NULL DEFAULT '',
    status                text NOT NULL DEFAULT 'off',        -- on | off
    gray_batch            int,
    gray_ratio            numeric(5,4) NOT NULL DEFAULT 0,
    category_label        text NOT NULL DEFAULT '上肢协调',
    play_mode             text NOT NULL DEFAULT 'active-force',
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 训练摘要（高频采样原始文件另存 S3，摘要入 PG 供统计/后台查询）
CREATE TABLE IF NOT EXISTS training_records (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    record_id          text NOT NULL UNIQUE,
    user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
    game_id            text NOT NULL,
    game_name          text NOT NULL DEFAULT '',
    device_model_id    text NOT NULL DEFAULT '',
    device_model_name  text NOT NULL DEFAULT '',
    capability_tags    text[] NOT NULL DEFAULT '{}',
    statistics         jsonb NOT NULL DEFAULT '{}',
    client_version     text NOT NULL DEFAULT '',
    completed_at       timestamptz NOT NULL,
    uploaded_at        timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_records_user ON training_records(user_id);
CREATE INDEX IF NOT EXISTS idx_training_records_game ON training_records(game_id);
CREATE INDEX IF NOT EXISTS idx_training_records_completed ON training_records(completed_at DESC);

-- 第三方 OAuth 身份（provider: wechat 等；openid/unionid 联合唯一）
CREATE TABLE IF NOT EXISTS oauth_identities (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider   text NOT NULL,
    openid     text NOT NULL,
    unionid    text,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, openid)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_unionid ON oauth_identities(provider, unionid) WHERE unionid IS NOT NULL;
