// 流式替换器单测：node --test test/（Node ≥ 22.6 / 24 原生跑 TS）
import test from "node:test";
import assert from "node:assert/strict";
import { makeByteReplacer } from "../src/replacer.ts";

async function apply(
  input: string,
  chunkSize: number,
  pairs: [string, string][],
): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.subarray(i, i + chunkSize));
      }
      controller.close();
    },
  }).pipeThrough(makeByteReplacer(pairs));
  return await new Response(stream).text();
}

test("单 chunk 基本替换", async () => {
  assert.equal(
    await apply("hello Hugging Face world", 1024, [
      ["Hugging Face", "HF Mirror"],
    ]),
    "hello HF Mirror world",
  );
});

test("模式跨 chunk 边界", async () => {
  const input = "xxxx Hugging Face yyyy".repeat(50);
  const expected = "xxxx HF Mirror yyyy".repeat(50);
  for (const size of [1, 3, 7, 12, 13, 1024]) {
    assert.equal(
      await apply(input, size, [["Hugging Face", "HF Mirror"]]),
      expected,
      `chunk=${size}`,
    );
  }
});

test("替换产物自包含（</body> 注入）不回扫、不无限替换", async () => {
  const pairs: [string, string][] = [
    ["</body>", '<script src="/direct-links.js" defer></script></body>'],
  ];
  assert.equal(
    await apply("<body>a</body>b</body>", 2, pairs),
    '<body>a<script src="/direct-links.js" defer></script></body>b<script src="/direct-links.js" defer></script></body>',
  );
});

test("多模式取最早匹配（链接改写 + 品牌替换）", async () => {
  const input = 'x "Hugging Face" y https://huggingface.co/z "Hugging Face"';
  const expected = 'x "HF Mirror" y https://mirror.test/z "HF Mirror"';
  assert.equal(
    await apply(input, 5, [
      ["https://huggingface.co", "https://mirror.test"],
      ["Hugging Face", "HF Mirror"],
    ]),
    expected,
  );
});

test("UTF-8 多字节跨边界原样通过（逐字节分片）", async () => {
  const input = "中文🤗表情huggingface.co".repeat(20);
  for (const size of [1, 2, 3, 5]) {
    assert.equal(
      await apply(input, size, [["zzz", "yyy"]]),
      input,
      `chunk=${size}`,
    );
  }
});

test("替换贴近缓冲尾部：产物不落入保留区被重复替换", async () => {
  const pairs: [string, string][] = [
    ["</body>", '<script src="/direct-links.js" defer></script></body>'],
  ];
  const expected =
    '<p>x<script src="/direct-links.js" defer></script></body>';
  for (const size of [1, 5, 9, 11]) {
    assert.equal(await apply("<p>x</body>", size, pairs), expected, `chunk=${size}`);
  }
});

test("模式整体落在 flush 残尾", async () => {
  assert.equal(await apply("abc123", 4, [["c123", "X"]]), "abX");
});

test("空输入", async () => {
  assert.equal(await apply("", 8, [["a", "b"]]), "");
});
