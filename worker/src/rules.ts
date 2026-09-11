// 与 deploy/Caddyfile 逐条对应的请求匹配规则。
// 正则保持与 Caddy 版本一致，改一处必须同步改另一处。

// header({'User-Agent': '*SemrushBot*', 'User-Agent': '*MJ12bot*'}) → 403
export const BAD_BOTS = /semrushbot|mj12bot/i;

// 扫描器诱饵：只拦顶层点文件与第二段伪目录形式。合法仓库文件路径
// /<org>/<repo>/resolve/main/.env 等不受影响（点文件在第三段及以后）→ 404
export const SCANNER_BAIT =
  /^\/\.|^\/[^/]+\/\.(env|git|aws|svn|htaccess|htpasswd)|^\/(?:env|wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|adminer|actuator)(?:\/|$)/;

// 合规屏蔽 → 403
export const ILLEGAL = /[xX][jJ][pP]|[Xx][Ii][Jj][Ii][Nn]|[Jj][Ii][Nn][Pp][Ii][Nn]/;

// 模型文件链接不缓存 / 防盗链判定（Caddy: .*/resolve/main/.*）
export const RESOLVE_MAIN = /\/resolve\/main\//;

// 项目页（/org/repo、/datasets/org/repo、/spaces/org/repo、*/tree/main）
// 两个正则覆盖的路径做站内链接与品牌名替换
export const PROJECT_PAGE = /^\/[^/]+\/[^/]+\/?$|\/tree\/main\/?$/;

// /models、/datasets 列表页与 /docs：注入 direct-links.js
export const INJECT_DIRECT = /^\/(?:models|datasets|docs)(?:\/|$)/;

// 前端主 bundle：替换品牌名（Caddy: handle /front/build/kube-*/index.js）
export const KUBE_BUNDLE = /^\/front\/build\/kube-[^/]+\/index\.js$/;

// Caddy @static：本地静态文件
export const STATIC_PATHS = new Set([
  "/",
  "/favicon.ico",
  "/logo.svg",
  "/invalid_referer.html",
  "/login_error.html",
  "/scripts.js",
  "/styles.css",
  "/robots.txt",
  "/direct-links.js",
]);

// 换 logo 区分原站
export const LOGO_PATH = "/front/assets/huggingface_logo-noborder.svg";

// skip_log 的等价判定：这些路径不写日志
export const ASSET_PATHS =
  /^\/(?:api\/event|cdn-cgi\/rum|front\/|avatars\/)|\.(?:js|css|png|jpe?g|gif|ico|woff|otf|ttf|eot|svg|txt|pdf|docx?|xlsx?)$/i;
