export interface Env {
  /** wrangler.jsonc 的 assets 绑定（dist/ 静态站点） */
  ASSETS: Fetcher;
  /**
   * 镜像主域名。可选：不设置时动态取请求 Host，
   * 与前端"动态域名、任意域名零维护"的哲学一致。
   * 多域名同站时留空即可。
   */
  MIRROR_HOST?: string;
}
