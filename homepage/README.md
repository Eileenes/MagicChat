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

生产文件输出到 `dist/`。默认按 GitHub Pages 地址 `https://duke-yeah.github.io/MagicChat/` 生成 canonical、sitemap 与资源路径；正式部署时可通过以下变量覆盖：

```bash
SITE_URL=https://example.com PUBLIC_BASE_PATH=/ npm run build
```

## Google Analytics

在构建或部署环境中设置 GA4 Measurement ID：

```bash
PUBLIC_GA_ID=G-XXXXXXXXXX npm run build
```

未设置或格式无效时不会加载 Google Analytics。启用后，页面会先以拒绝分析存储的 Consent Mode 初始化，访客允许后再更新授权状态。

GitHub Pages 工作流会读取仓库变量 `GA_MEASUREMENT_ID`。在仓库 Settings → Secrets and variables → Actions → Variables 中添加该变量即可启用生产环境统计。

## SEO

- 静态 HTML、语义化标题结构与可抓取正文
- canonical、robots、Open Graph、Twitter Card 与 `hreflang`
- Organization 与 SoftwareApplication JSON-LD
- 构建生成 `/sitemap.xml` 和 `/robots.txt`
- 独立 `/privacy/` 页面
