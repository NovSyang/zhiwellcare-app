# 生产部署与运维（后端）

## 一、镜像构建

```bash
cd backend
docker build -t zhiwellcare-backend:0.1.0 .
```

## 二、环境变量注入（生产）

| 变量 | 说明 |
|---|---|
| `APP_DB_URL` | PostgreSQL 连接串（**必填**；建议独立用户最小权限 + sslmode=require） |
| `APP_JWT_SECRET` | 32+ 字节随机串，启动前用 `openssl rand -hex 32` 生成并密钥管理 |
| `APP_CORS_ORIGINS` | 正式域名 `https://game.zhiwellcare.com` 及内测来源 |
| `APP_ADMIN_BOOTSTRAP_PHONE` | 首次部署前先用手机号注册，再注入该值重启完成管理员引导后移除 |
| `APP_WECHAT_APPID/SECRET` | 见 `WECHAT_ACTIVATION.md` |

## 三、域名与反向代理（复用产品域名策略）

- 正式：`game.zhiwellcare.com`（子域名，静态 Web 产物与 `/api` 同域，天然规避跨域）；
- 测试：现有 CDN 域名 `/game-app` 路径部署，后端 CORS 需放行该来源；
- Nginx 片段：`location /api/ { proxy_pass http://127.0.0.1:8080; }`，Web 产物由静态/CDN 层承载；
- 对外必须 HTTPS（TLS 证书 + HSTS）；`SecurityHeaders` 中间件已输出基础安全响应头。

## 四、数据与备份

- 迁移：`backend/migrations/*.sql` 启动时幂等执行（按文件名排序）；生产库变更走同样追加迁移。
- 备份：PG `pg_dump` 定时 + PITR；`training_records` 建议按月分区（大数据量演进）。
- Redis/S3 预留：会话/目录热点与训练原始采样文件存储后续按需接入，接口层已留扩展位。

## 五、健康与监控

- `GET /healthz` 探活（存活/就绪探针均可指向）。
- 访问日志为 slog JSON（stdout），可接入云日志服务。
- 压测/限流：`/auth/*` 已做内存限流；生产建议前置网关级限流（按账号+IP）。
