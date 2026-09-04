# 智为康乐管理后台 API 契约（v1）

- 基址：`http://127.0.0.1:8080/api/v1`（正式：`https://game.zhiwellcare.com/api/v1`）
- 鉴权：除登录外全部 `Authorization: Bearer <accessToken>`；后台接口要求 `role=admin`
- 响应统一：`{"code":0,"message":"ok","data":…}`，`code!=0` 视为失败（与 HTTP 状态一致）
- 登录：`POST /auth/login` body `{"phone","password"}` → `data:{user:{id,phoneMasked,nickname,role}, tokens:{accessToken,refreshToken}}`
- 本机管理账号：`13800008888 / admin123456`（兼容 `13900002222 / demo123456`，角色 admin）

## 后台运营接口（全部 admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/stats/dashboard` | 仪表盘计数 `{deviceModels,games,users,trainingRecords,todayRecords}` |
| GET | `/admin/devices` | 设备型号列表（含 off） |
| POST | `/admin/devices` | 新建/更新型号（upsert） |
| PUT | `/admin/devices/:modelId` | 更新型号 |
| DELETE | `/admin/devices/:modelId` | 删除型号 |
| PATCH | `/admin/devices/:modelId/status` | body `{"status":"on"|"off"}` |
| GET | `/admin/games` | 游戏目录列表（含 off） |
| POST | `/admin/games` | 新建/更新游戏（upsert） |
| PUT | `/admin/games/:gameId` | 更新游戏 |
| DELETE | `/admin/games/:gameId` | 删除游戏 |
| PATCH | `/admin/games/:gameId/status` | body `{"status":"on"|"off"}` |
| GET | `/admin/users?keyword=&status=&page=&pageSize=` | 用户列表（status: -1 全部/0 禁用/1 正常）`data:{items,total}` |
| PATCH | `/admin/users/:id/status` | body `{"status":0\|1}`（不可停用自己） |
| GET | `/admin/training-records?page=&pageSize=&gameId=&modelId=` | 训练摘要 `data:{items,total}` |

### 设备型号字段（DeviceModel）

```json
{
  "modelId": "wobble-wrist-band",
  "name": "不倒翁手腕训练仪",
  "manufacturer": "智为康乐",
  "category": "wrist",
  "description": "…（消费版主动训练口径，禁止医疗表述）",
  "capabilityTags": ["posture-sensor"],
  "supportedHandleTags": [],
  "namePatterns": ["bt91","wobble"],
  "protocol": "bs-bt91",
  "minAppVersion": "0.1.0",
  "firmwareUpdatable": true,
  "icon": "⌚",
  "status": "on"
}
```

### 游戏字段（GameCatalogItem）

```json
{
  "gameId": "target-reach",
  "name": "四方挥腕挑战",
  "summary": "…",
  "requiredTags": ["posture-sensor"],
  "durationPresetsMin": [1,3,5],
  "resourceVersion": "1.0.0",
  "resourceUrl": "",
  "status": "on",
  "grayBatch": null,
  "grayRatio": 0,
  "categoryLabel": "腕部协调",
  "playMode": "active-force"
}
```

标签常量：设备能力 `posture-sensor / torque-sensor / six-axis-imu / grip-sensor`；手柄二级 `handle-steering-wheel / handle-sphere / handle-t / handle-key`。
匹配公式：**设备能力标签 ⊇ 游戏所需标签**（公开接口 `GET /device/:modelId/games` 已实现过滤）。

## 面向 APP 的公开目录

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/catalog/devices` | 上架设备型号 |
| GET | `/catalog/games` | 上架游戏 |
| GET | `/device/:modelId/games` | 该型号可用游戏（标签匹配结果） |

## 训练记录（APP 侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/training/records` | 鉴权上报 `{recordId,gameId,gameName,completedAt(ms),device:{modelId,modelName,capabilityTags},statistics,clientVersion}` |
| GET | `/me/training-records` | 个人云端记录 |
