import { getRuntimeRequire } from "./runtime-require";

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 18_000;

function publicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0)) && !(a === 198 && (b === 18 || b === 19))
    && !(a === 192 && b === 0) && !(a === 198 && b === 51) && !(a === 203 && b === 0);
}

export function checkedWebUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("请输入完整的 HTTP 或 HTTPS 地址"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new Error("只能读取公开 HTTP 或 HTTPS 地址");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname.endsWith(".internal") || hostname.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    throw new Error("不能读取本机或内网地址");
  }
  return url;
}

export function extractWebText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,aside,form,iframe").forEach((node) => node.remove());
  const title = doc.title.trim();
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
  const text = (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("网页没有可读取的正文，可能需要登录或由脚本动态加载");
  return { title, text };
}

export function extractFeedText(xml: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("RSS 或 XML 格式无效");
  const title = doc.querySelector("channel > title, feed > title")?.textContent?.trim() ?? "";
  const items = [...doc.querySelectorAll("item, entry")].slice(0, 15);
  if (items.length) return {
    title,
    text: items.map((item) => {
      const name = item.querySelector("title")?.textContent?.trim() ?? "";
      const link = item.querySelector("link")?.getAttribute("href") ?? item.querySelector("link")?.textContent?.trim() ?? "";
      const summary = item.querySelector("description, summary, content")?.textContent?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
      return [name, link, summary].filter(Boolean).join(" — ");
    }).join("\n").slice(0, MAX_TEXT),
  };
  const text = (doc.documentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) throw new Error("XML 没有可读取的内容");
  return { title, text };
}

export async function readWebPage(input: string, signal: AbortSignal): Promise<{ url: string; title: string; text: string }> {
  const require = getRuntimeRequire();
  if (!require) throw new Error("当前设备尚未提供网页读取能力");
  const dns = require("node:dns") as typeof import("node:dns");
  const https = require("node:https") as typeof import("node:https");
  const http = require("node:http") as typeof import("node:http");
  let url = checkedWebUrl(input);
  for (let redirect = 0; redirect <= 3; redirect++) {
    signal.throwIfAborted();
    const addresses = await dns.promises.resolve4(url.hostname);
    if (!addresses.length || addresses.some((address) => !publicIpv4(address))) throw new Error("不能读取本机或内网地址");
    const address = addresses[0]!;
    const response = await new Promise<{ status: number; location?: string; contentType: string; body: string }>((resolve, reject) => {
      const req = (url.protocol === "https:" ? https : http).request({
        hostname: address, ...(url.protocol === "https:" ? { servername: url.hostname } : {}), path: `${url.pathname}${url.search}`,
        method: "GET", timeout: 15_000,
        headers: { Host: url.host, Accept: "text/html,text/plain,text/markdown,application/rss+xml,application/atom+xml,application/xml,application/json", "Accept-Encoding": "identity", "User-Agent": "QiaomuAgent/0.1 (+web-page-reader)" },
      }, (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400) { res.resume(); resolve({ status, location, contentType: "", body: "" }); return; }
        if (status !== 200) { res.resume(); reject(new Error(`网页返回 HTTP ${status}`)); return; }
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (!/^(text\/(html|plain|markdown|xml)|application\/(rss\+xml|atom\+xml|xml|json))\b/.test(contentType)) { res.resume(); reject(new Error("暂不支持这个链接的内容类型")); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) { req.destroy(new Error("网页内容过大")); return; }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("网页读取超时")));
      req.on("error", reject);
      signal.addEventListener("abort", () => req.destroy(signal.reason), { once: true });
      req.end();
    });
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirect === 3) throw new Error("网页跳转次数过多");
      url = checkedWebUrl(new URL(response.location, url).href);
      continue;
    }
    const parsed = /\b(xml|rss\+xml|atom\+xml)\b/.test(response.contentType)
      ? extractFeedText(response.body)
      : response.contentType.startsWith("text/plain") || response.contentType.startsWith("text/markdown") || response.contentType.startsWith("application/json")
      ? { title: "", text: response.body.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) }
      : extractWebText(response.body);
    if (!parsed.text) throw new Error("网页没有可读取的正文");
    return { url: url.href, ...parsed };
  }
  throw new Error("网页跳转次数过多");
}
