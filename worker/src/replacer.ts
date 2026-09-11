/**
 * 字节级流式替换，等价于 Caddy 的 replace-stream 插件。
 *
 * 全部在字节域处理：搜索串/替换串限定 ASCII（本项目三种替换均满足），
 * 因此天然 UTF-8 安全 —— ASCII 字节不可能出现在多字节序列内部，
 * 未命中的字节原样透传，对任意二进制内容也无损。
 *
 * - 模式跨 chunk 边界：无完整匹配的残尾（< 最长模式长度）留待与下个 chunk 拼接
 * - 多模式并发：每轮取最靠前的匹配，替换产物不再回扫（</body> 注入产物
 *   自身以 </body> 结尾，回扫会造成无限替换）
 */
const encoder = new TextEncoder();

export function makeByteReplacer(
  pairs: [string, string][],
): TransformStream<Uint8Array, Uint8Array> {
  const searches = pairs.map(([s]) => encoder.encode(s));
  const replaces = pairs.map(([, r]) => encoder.encode(r));
  const maxSearch = Math.max(...searches.map((s) => s.length));
  let tail: Uint8Array = new Uint8Array(0);

  function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  // 朴素查找 + 首字节过滤：模式最长 22 字节，KMP 不划算
  function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
    const first = needle[0];
    const end = hay.length - needle.length;
    outer: for (let i = from; i <= end; i++) {
      if (hay[i] !== first) continue;
      for (let j = 1; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  // 对完整缓冲做全量替换。返回 restStart：未匹配余段在产物中的起点
  //（替换只发生在余段之前，余段字节与原缓冲一致）
  function replaceAll(buf: Uint8Array): { out: Uint8Array; restStart: number } {
    const parts: Uint8Array[] = [];
    let i = 0;
    let produced = 0;
    for (;;) {
      let hit = -1;
      let which = -1;
      for (let k = 0; k < searches.length; k++) {
        const at = indexOf(buf, searches[k], i);
        if (at !== -1 && (hit === -1 || at < hit)) {
          hit = at;
          which = k;
        }
      }
      if (hit === -1) break;
      parts.push(buf.subarray(i, hit), replaces[which]);
      produced += hit - i + replaces[which].length;
      i = hit + searches[which].length;
    }
    const restStart = produced;
    parts.push(buf.subarray(i));
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return { out, restStart };
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const buf = concat(tail, chunk);
      const { out, restStart } = replaceAll(buf);
      // 完整匹配已在全量扫描中处理掉，余段不可能含完整模式，
      // 保留区只需容纳"模式前缀"：maxSearch - 1 字节，且只从余段取
      //（若从替换产物取，产物尾部的 </body> 前缀下轮会被重复替换）
      const keep = Math.min(maxSearch - 1, out.length - restStart);
      const cut = out.length - keep;
      if (cut > 0) controller.enqueue(out.subarray(0, cut));
      tail = out.subarray(cut);
    },
    flush(controller) {
      const { out } = replaceAll(tail);
      if (out.length > 0) controller.enqueue(out);
    },
  });
}
