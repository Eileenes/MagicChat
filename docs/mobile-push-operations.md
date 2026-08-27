# 手机推送运行监控

私有 Server 在 `/metrics` 暴露 Prometheus 文本指标；公共 Push Gateway 在 `https://push.jiying.chat/api/metrics` 暴露匿名聚合指标。两个端点都不包含用户、私有服务器地址、会话、消息、设备 token、grant capability 或 route token。

## 指标

私有 Server：

- `magicchat_mobile_push_enabled`
- `magicchat_mobile_push_events{status}`
- `magicchat_mobile_push_jobs{status}`
- `magicchat_mobile_push_grants{status}`
- `magicchat_mobile_push_oldest_pending_event_age_seconds`
- `magicchat_mobile_push_oldest_pending_job_age_seconds`

公共 Push Gateway：

- `push_gateway_jobs{status}`
- `push_gateway_grants{status}`
- `push_gateway_installations{provider,platform,status}`
- `push_gateway_oldest_pending_job_age_seconds`

## 启用内置 Prometheus

仓库提供可选的 Compose `monitoring` profile。它会抓取 Compose 内的私有 Server 和固定生产 Gateway，并加载 `deploy/monitoring/push-alerts.yml`：

```bash
docker compose --profile monitoring up -d prometheus
```

Prometheus 默认只监听宿主机 `127.0.0.1:19090`，可通过 `PROMETHEUS_PORT` 修改端口。数据保留 30 天并写入 `prometheus-data` volume。规则覆盖指标不可用、event fanout 积压、私有投递积压和 Gateway 投递积压。

内置 profile 不预设 Alertmanager 接收人，因为 webhook、邮件、企业微信或钉钉地址属于部署密钥。生产环境应在 `deploy/monitoring/prometheus.yml` 中增加部署方的 `alerting.alertmanagers`，并由独立 Secret 管理接收端配置，不应将接收地址或凭据提交到仓库。

## 排查

先区分 event 和 job：

- event 积压通常表示数据库、fanout 策略查询或私有 Server Worker 异常；
- 私有 job 积压通常表示 Gateway 网络、Gateway 限流或私有 Worker 异常；
- Gateway job 积压通常表示 APNs 或未来 Android Provider 超时、限流或凭据异常。

`retry` 数量和最老待处理年龄同时持续上升时，应一起检查私有 Server 与公共 Push Gateway 日志。
