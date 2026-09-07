# 构建带插件的 Caddy：replace-response(响应改写) + transform-encoder(日志格式)
# cloudflare 仅在启用泛域名 DNS-01 证书时需要，一并编入。
FROM caddy:builder AS builder
RUN xcaddy build \
      --with github.com/caddyserver/replace-response \
      --with github.com/caddyserver/transform-encoder \
      --with github.com/caddy-dns/cloudflare

FROM caddy:alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# 静态站点（首页 / 错误页）
COPY dist /srv/www
