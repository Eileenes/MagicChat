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

## 样式与字体

官网使用 Tailwind CSS v4 管理主题、布局、间距、颜色和响应式样式。常规组件通过语义类组合 Tailwind utilities，产品界面示意图、伪元素和交互动效保留少量原生 CSS。

字体使用 [Noto Sans SC Variable](https://fontsource.org/fonts/noto-sans-sc)，通过 Fontsource 自托管，不依赖外部字体 CDN；浏览器根据 `unicode-range` 只请求当前页面实际使用的字体切片。

## Google Analytics

官网默认使用 GA4 Measurement ID `G-BW65KYSTXM`，页面加载后直接启用统计。需要切换到其他 GA4 属性时，可在构建或部署环境中覆盖：

```bash
PUBLIC_GA_ID=G-XXXXXXXXXX npm run build
```

格式无效的 Measurement ID 不会加载 Google Analytics。

## SEO

- 静态 HTML、语义化标题结构与可抓取正文
- canonical、robots、Open Graph、Twitter Card 与 `hreflang`
- Organization 与 SoftwareApplication JSON-LD
- 构建生成 `/sitemap.xml` 和 `/robots.txt`
- 独立 `/user-service/` 用户服务页，以及 `/privacy-policy/`、`/user-agreement/` 文档页

## Docker 部署

GitHub Actions 在 `main` 分支和版本标签更新时构建并推送官网镜像：

```text
ghcr.io/chaitin/magicchat/homepage
```

生产服务器默认通过 `ghcr.1ms.run/chaitin/magicchat/homepage:latest` 镜像代理拉取。

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

## 自动更新

仓库提供 systemd oneshot 服务和定时器，每小时检查一次 `latest` 镜像 digest。镜像没有变化时保留当前容器；有变化时执行 `docker compose up -d --pull always --remove-orphans`，证书与日志挂载不受影响。

在服务器安装并启用：

```bash
sudo install -m 0755 systemd/jiying-homepage-update /usr/local/sbin/jiying-homepage-update
sudo install -m 0644 systemd/jiying-homepage-update.service /etc/systemd/system/jiying-homepage-update.service
sudo install -m 0644 systemd/jiying-homepage-update.timer /etc/systemd/system/jiying-homepage-update.timer
sudo systemctl daemon-reload
sudo systemctl enable --now jiying-homepage-update.timer
```

查看下次执行时间和运行日志：

```bash
systemctl list-timers jiying-homepage-update.timer
journalctl -u jiying-homepage-update.service
```
