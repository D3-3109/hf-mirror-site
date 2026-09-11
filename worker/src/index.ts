import { proxyUpstream, serveStatic } from "./proxy";
import {
  ASSET_PATHS,
  BAD_BOTS,
  ILLEGAL,
  LOGO_PATH,
  RESOLVE_MAIN,
  SCANNER_BAIT,
  STATIC_PATHS,
} from "./rules";
import type { Env } from "./types";

// 防盗链：允许无 Referer 的 API 客户端，拒绝第三方站点外链 /resolve/ 直链
function isHotlinked(request: Request, mirrorHost: string): boolean {
  const referer = request.headers.get("referer");
  if (!referer) return false;
  const escaped = mirrorHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const allowed = new RegExp(
    `^https?://([a-z0-9-]+\\.)?${escaped}(/|$)`,
  );
  return !allowed.test(referer);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    // 不设 MIRROR_HOST 时动态取请求 Host：任意域名零维护
    const mirrorHost = env.MIRROR_HOST || url.host;

    const started = Date.now();
    const respond = (res: Response): Response => {
      // skip_log 等价：静态资源与埋点路径不产生日志事件
      if (!ASSET_PATHS.test(path)) {
        console.log(`${request.method} ${path} ${res.status} ${Date.now() - started}ms`);
      }
      return res;
    };

    // ---- 请求侧规则，语义顺序与 Caddyfile 一致（rewrite 先于 handle）----

    // 换 logo 区分原站
    if (path === LOGO_PATH) {
      return respond(await serveStatic(env, "/logo.svg"));
    }
    // 防盗链：第三方外链 /resolve/ 直链 → 错误页
    if (RESOLVE_MAIN.test(path) && isHotlinked(request, mirrorHost)) {
      return respond(await serveStatic(env, "/invalid_referer.html"));
    }
    // 镜像站禁止登录
    if (path === "/login" || path === "/join") {
      return respond(await serveStatic(env, "/login_error.html"));
    }
    if (BAD_BOTS.test(request.headers.get("user-agent") ?? "")) {
      return respond(new Response(null, { status: 403 }));
    }
    // 扫描器诱饵本地 404，不回源，避免烧掉上游 429 限流配额
    if (SCANNER_BAIT.test(path)) {
      return respond(new Response(null, { status: 404 }));
    }
    if (STATIC_PATHS.has(path)) {
      return respond(await serveStatic(env, path));
    }
    // 吞掉前端埋点
    if (path === "/api/event") {
      return respond(new Response("OK"));
    }
    // CF 保留路径，正常到不了这里；保留兜底与 Caddy 行为一致
    if (path === "/cdn-cgi/rum") {
      return respond(new Response(null, { status: 204 }));
    }
    // 合规屏蔽
    if (ILLEGAL.test(path)) {
      return respond(new Response("invalid request", { status: 403 }));
    }

    // 其余全部反代 huggingface.co（含三处响应体流式改写与 Location 改写）
    return respond(await proxyUpstream(request, mirrorHost, path));
  },
} satisfies ExportedHandler<Env>;
