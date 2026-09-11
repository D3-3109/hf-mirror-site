# hf-mirror Cloudflare Worker

Caddy 版的 Cloudflare Workers 等价实现。**只代理控制面（API/页面），
数据面不变**：`resolve` 302 到 `us.aws.cdn.hf.co` 的 Location 不改写，
大文件字节流照旧客户端直连 CDN，不过 Workers。`xet.Caddyfile` 第三层
未移植（保持默认关闭的立场不变）。

## 与 Caddy 版的功能映射

| Caddyfile | Worker |
|---|---|
| `reverse_proxy https://huggingface.co` | `fetch()` 透传，`redirect: manual` |
| `replace stream`（项目页/bundle/注入脚本，共 3 处） | `src/replacer.ts` 字节级流式替换（跨 chunk 安全） |
| `header_down Location huggingface.co` | 响应头改写，`us.aws.cdn.hf.co` 原样放行 |
| `@static` + `file_server`（dist/） | Workers Static Assets（请求免费不计费） |
| 徽标改写、防盗链、扫描器诱饵、badbots、合规屏蔽、禁登录、埋点吞掉、缓存头 | `src/index.ts` 按 Caddyfile 语义顺序逐条实现 |
| `encode zstd gzip` / TLS / HTTP-3 | CF 边缘自动 |
| stdout 日志 + `skip_log` | Workers Logs（`observability`），资产路径不产生事件 |

## 相对 Caddy 版的有意差异

1. **`MIRROR_HOST` 可省略**：默认动态取请求 Host，多域名/换域名零配置
   （与前端"动态域名"哲学一致）。要固定就设 `wrangler.jsonc` 的
   `vars.MIRROR_HOST`。
2. **项目页与列表页规则重叠处取并集**：Caddy 的 `handle` 排序里
   `/datasets/org/repo` 这类两段路径在 `@inject_direct` 与 `@project_page`
   之间的实际命中依赖内部排序；Worker 版对重叠路径同时做改写+注入，
   语义上是两者中更完整的那个（对被墙用户无差异，可直连用户获得直达链接）。
3. **`Server: hf-mirror` 响应头**：Worker 里已设置，但 CF 边缘可能统一
   覆写为 `Server: cloudflare`，以线上实际响应为准。
4. **日志**：Workers Logs 免费档有每日事件量与保留期限制，重观测需求可加
   Logpush（付费）。

## 本地验证

```bash
cd worker
npm install
npm run typecheck
npm test                 # 流式替换器单测（跨 chunk/自包含/UTF-8 等边界）
npx wrangler dev         # http://localhost:8787，动态域名模式
```

dev 实测清单（无需任何配置即可跑）：

```bash
curl -s localhost:8787/                          # 首页（静态）
curl -s localhost:8787/login                     # 登录错误页
curl -s localhost:8787/.env -o /dev/null -w '%{http_code}\n'    # 404
curl -s -H 'User-Agent: SemrushBot/x' -o /dev/null -w '%{http_code}\n' localhost:8787/models  # 403
curl -s -H 'Referer: https://evil.com' localhost:8787/org/repo/resolve/main/a.bin   # 防盗链页
curl -s localhost:8787/org/repo | grep -o 'HF Mirror'           # 项目页品牌改写
curl -s localhost:8787/models | grep -o 'direct-links.js'       # 列表页脚本注入
curl -sI localhost:8787/org/repo/resolve/main/x                  # 看 Location 是否指向 us.aws.cdn.hf.co 原样
```

## 部署

```bash
cd worker
npx wrangler login
# 编辑 wrangler.jsonc：取消 routes 注释并改成你的镜像域名
npx wrangler deploy
```

或走 CI：GitHub secrets 配 `CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit +
Workers Routes:Edit），push `worker/**` 或 `dist/**` 自动部署。

**必须用自定义域名**：`*.workers.dev` 在大陆被 DNS 污染，只能当测试入口。

## 上线前 PoC 清单（先验证再切流量）

1. **大陆访问质量**：多地实测自定义域名速度，与 VPS 版对比
   （CF 免费版国际线路晚高峰波动大）。
2. **HF 侧风控**：`HF_ENDPOINT=https://镜像域名 hf download <小模型>`
   全流程（装/不装 hf_xet 各一次）；高频 API 调用观察 429；
   `/docs` 是否弹 AWS WAF 质询（Workers 出口是 CF 共享 IP 段，行为未知）。
3. **配额**：先免费版观察 CPU 时间与请求数（10ms CPU + 10 万请求/天），
   出现超限或 bundle 改写变慢就上 $5 Workers Paid（30s CPU + 1000 万请求/月）。
4. 回退：VPS 版保持在线，DNS 切回即可——两版行为对齐，可随时互为备份。
