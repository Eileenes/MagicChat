# 即应官网首页

`homepage` 是即应官网的静态生成实现。页面使用 Astro 构建，正文和 SEO 元信息直接输出为 HTML，不依赖客户端路由或 JavaScript 渲染。

## 本地开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run check
npm run build
npm run preview
```

生产文件输出到 `dist/`。正式部署时设置站点域名和部署路径，用于生成 canonical、sitemap 与静态资源地址：

```bash
SITE_URL=https://example.com PUBLIC_BASE_PATH=/ npm run build
```

## Google Analytics

在构建或部署环境中设置 GA4 Measurement ID：

```bash
PUBLIC_GA_ID=G-XXXXXXXXXX npm run build
```

未设置或格式无效时不会加载 Google Analytics。启用后，页面会先以拒绝分析存储的 Consent Mode 初始化，访客允许后再更新授权状态。

## SEO

- 静态 HTML、语义化标题结构与可抓取正文
- canonical、robots、Open Graph、Twitter Card 与 `hreflang`
- Organization 与 SoftwareApplication JSON-LD
- 构建生成 `/sitemap.xml` 和 `/robots.txt`
- 独立 `/privacy/` 页面

## Docker 部署

GitHub Actions 在 `main` 分支和版本标签更新时构建并推送官网镜像：

```text
ghcr.io/chaitin/magicchat/homepage
```

部署前确保 `jiying.chat` 的 A/AAAA 记录指向服务器，并开放 TCP 80 和 443。然后在服务器保存 `compose.yml`，创建持久化目录并启动：

```bash
mkdir -p data/caddy/data data/caddy/config data/caddy/logs data/releases
docker compose pull
docker compose up -d
```

如果 GHCR 包不是公开的，需要先使用具有 `read:packages` 权限的 Token 登录：

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
```

持久化目录用途：

- `data/caddy/data`：证书、私钥、ACME 账户和续期状态
- `data/caddy/config`：Caddy 运行配置
- `data/caddy/logs`：`access.log` 与 `error.log`
- `data/releases`：通过 `https://jiying.chat/releases/<文件名>` 发布的静态文件

`data/releases` 以只读方式挂载进容器。默认不启用目录列表，只允许访问明确的文件路径。容器健康检查会通过 Caddy 实际读取构建后的首页文件；建议另外使用外部监控定期请求 `https://jiying.chat/healthz`，覆盖 DNS、网络和证书状态。

升级使用：

```bash
docker compose pull
docker compose up -d
```
