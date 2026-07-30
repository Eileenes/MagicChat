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
