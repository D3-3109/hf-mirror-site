# hf-mirror-site（自部署）

Hugging Face 镜像站，纯 Caddy 反向代理，无后端代码。基于
[padeoe/hf-mirror-site](https://github.com/padeoe/hf-mirror-site) 修订
（上游未附带 LICENSE，本项目为其改部署版，改动了路由、页面与构建方式）。

## 架构

```
客户端 ──API/页面/resolve──▶ 镜像域名 ──反代──▶ huggingface.co
       └─文件字节(302直连)──▶ us.aws.cdn.hf.co（CloudFront，国内可直连）
```

- **控制面走镜像，数据面直连**：`resolve` 302 到 `us.aws.cdn.hf.co` 的 xet-bridge
  不改写，客户端直连 CDN，镜像出口 IP 不承受大文件流量
- **直连分流（429 防护）**：前台探测
  `fetch('https://huggingface.co/favicon.ico', {mode:'no-cors'})`（5s 超时，
  sessionStorage 缓存 30 分钟）。可直连 huggingface.co 的用户：
  首页热门卡片/教程链接直达原站；`/models`、`/datasets` 列表页与 `/docs/*`
  由 Caddy 注入 `direct-links.js`，把仓库卡片与文档链接改写回原站。
  被墙用户无感走镜像
- **可选第三层**（`deploy/xet.Caddyfile`，默认关闭）：Xet 数据面收拢到
  `hfcdn`/`hf-cas`/`hf-xetdl` 子域，数据面被墙时再启用，DNS 预留即可

## 相对上游的修订

- 删除 cdn-lfs 相关改写（HF 已退役 cdn-lfs，上游配置是死代码）与 hfd 工具
- 删除上游错误页里的 Google AdSense 与硬编码 hf-mirror.com 链接
- Referer 防盗链正则参数化，并修复上游 `(\.*\.)?` 子域匹配笔误
- 前端重设计：系统字体栈、暗色模式、动态域名（教程示例按 `location.hostname`
  渲染，任意域名零维护）、内容同步到 `hf` CLI 时代
- 日志 stdout；登录/注册在镜像上禁用

## 部署

镜像由 GitHub Actions 构建并推送到 GHCR，VPS 无需本地构建：

```bash
git clone https://github.com/D3-3109/hf-mirror-site
cd hf-mirror-site/deploy
cp .env.example .env   # 编辑 MIRROR_HOST
docker compose pull
docker compose up -d
```

要求：VPS 的 80/443（含 UDP 443 / HTTP-3）可达，DNS A 记录指向 VPS，
Caddy 自动 HTTP-01 出证。`docker login ghcr.io`（PAT 勾 `read:packages`）
后可拉取；若把 GHCR package 设为 public 则无需登录。

更新：`git pull && docker compose pull && docker compose up -d`。
Caddyfile 是 bind mount，单独改它只需 `docker compose restart`。

### Cloudflare Workers 版（可选）

[worker/](worker/README.md) 是等价的 Workers 实现：同样只代理控制面，
数据面 302 直连不变；VPS/Docker 换成一个 `wrangler deploy`。
上线前先按其 README 里的 PoC 清单验证大陆访问质量与 HF 侧 429/WAF 行为。

```
├── dist/                # 静态站点（首页、错误页、direct-links.js）
├── deploy/
│   ├── Dockerfile       # caddy:builder + xcaddy（replace-response 等插件）
│   ├── Caddyfile        # 主配置
│   ├── xet.Caddyfile    # 可选：Xet 数据面收拢（实验性）
│   └── docker-compose.yml
└── .github/workflows/   # Actions 构建 GHCR 镜像
```

## 已知边界

- HF docs 挂 AWS WAF：目前镜像出口 IP 拿到真实内容；若开始弹 JS 质询，
  镜像 docs 不可用（这正是可直连用户被送往原站 docs 的原因）
- 校园网/企业网 captive portal 可能使 no-cors 探测误判"可直连"，
  30 分钟缓存过期后重测
- `us.aws.cdn.hf.co` 若进 GFW 名单，启用 `xet.Caddyfile` 第三层
