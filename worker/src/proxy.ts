import { makeByteReplacer } from "./replacer";
import { INJECT_DIRECT, KUBE_BUNDLE, PROJECT_PAGE, RESOLVE_MAIN } from "./rules";
import type { Env } from "./types";

const UPSTREAM = "https://huggingface.co";

// 镜像不应向 HF 泄露访客信息；Workers 子请求会自动带上这些头
const STRIP_REQUEST_HEADERS =
  /^(?:cf-.+|cdn-loop|x-forwarded-.+|x-real-ip|true-client-ip|forwarded)$/i;

// 与 Caddyfile 三处 replace stream 一一对应
function rewritePairsFor(
  path: string,
  mirrorHost: string,
): [string, string][] | null {
  // 前端主 bundle：替换品牌名
  if (KUBE_BUNDLE.test(path)) {
    return [["Hugging Face", "HF Mirror"]];
  }
  // 项目页：替换站内链接与品牌名，保持闭环
  if (PROJECT_PAGE.test(path)) {
    return [
      ["https://huggingface.co", `https://${mirrorHost}`],
      ["Hugging Face", "HF Mirror"],
    ];
  }
  // 列表页/docs：注入直连检测脚本
  if (INJECT_DIRECT.test(path)) {
    return [["</body>", '<script src="/direct-links.js" defer></script></body>']];
  }
  return null;
}

function hasRequestBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

export async function proxyUpstream(
  request: Request,
  mirrorHost: string,
  path: string,
): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (STRIP_REQUEST_HEADERS.test(name)) headers.delete(name);
  }

  const pairs = rewritePairsFor(path, mirrorHost);
  // 改写路由要求上游回明文（同 Caddy 的 header_up Accept-Encoding identity）
  if (pairs) headers.set("Accept-Encoding", "identity");

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + path + url.search, {
      method: request.method,
      headers,
      body: hasRequestBody(request.method) ? request.body : undefined,
      redirect: "manual", // Location 改写的前提：3xx 不跟随
    });
  } catch (err) {
    console.error(`upstream fetch failed ${request.method} ${path}: ${err}`);
    return new Response("upstream fetch failed", { status: 502 });
  }

  // WebSocket 升级透传（响应体为空，必须原样返回）
  if ((upstream as { webSocket?: WebSocket }).webSocket) return upstream;

  const res = new Response(upstream.body, upstream);

  // 数据面直连的关键：只改写 huggingface.co 的 Location，
  // us.aws.cdn.hf.co 的 302 原样放行，大文件流量不过镜像/Workers
  const location = res.headers.get("location");
  if (location) {
    res.headers.set(
      "location",
      location.replace(/huggingface\.co/g, mirrorHost),
    );
  }

  if (RESOLVE_MAIN.test(path)) {
    res.headers.set("Cache-Control", "no-cache");
  } else if (path.startsWith("/front/")) {
    // 原站前端静态资源缓存 3 天
    res.headers.set("Cache-Control", "public, max-age=259200");
  }
  res.headers.set("Server", "hf-mirror");

  // 防御：上游若无视 identity 回了压缩内容，原样透传，绝不改写二进制
  const encoding = (res.headers.get("content-encoding") ?? "identity")
    .toLowerCase();
  if (pairs && res.body && (encoding === "identity" || encoding === "")) {
    res.headers.delete("content-length");
    res.headers.delete("content-encoding");
    return new Response(res.body.pipeThrough(makeByteReplacer(pairs)), res);
  }
  return res;
}

/** 经 ASSETS 绑定取 dist/ 静态文件，缓存策略对齐 Caddy（no-cache） */
export async function serveStatic(env: Env, path: string): Promise<Response> {
  const res = await env.ASSETS.fetch(
    new Request(`https://assets.internal${path}`),
  );
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "no-cache");
  out.headers.set("Server", "hf-mirror");
  return out;
}
