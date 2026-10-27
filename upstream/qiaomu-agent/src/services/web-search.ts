import { requestUrl } from "obsidian";

export const WEB_SEARCH_SECRET_ID = "qiaomu-agent-brave-search";

export interface WebSearchHit { title: string; url: string; snippet: string }

export function normalizeBraveResults(body: unknown): WebSearchHit[] {
  const results = (body as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const hit = item as Record<string, unknown>;
    if (typeof hit.url !== "string" || !/^https?:\/\//i.test(hit.url)) return [];
    return [{
      title: typeof hit.title === "string" ? hit.title.slice(0, 180) : hit.url,
      url: hit.url,
      snippet: typeof hit.description === "string" ? hit.description.replace(/\s+/g, " ").slice(0, 600) : "",
    }];
  });
}

/** Search is a fixed vendor endpoint; result pages are never fetched here. */
export async function searchWeb(query: string, key: string, signal: AbortSignal): Promise<WebSearchHit[]> {
  const q = query.trim().slice(0, 500);
  if (!q) throw new Error("请输入搜索词");
  if (!key) throw new Error("请先在工具设置中连接 Brave Search");
  signal.throwIfAborted();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("搜索超时")), 15_000);
    onAbort = () => reject(signal.reason ?? new Error("搜索已取消"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const response = await Promise.race([requestUrl({
    url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=6`,
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
    throw: false,
  }), deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
  signal.throwIfAborted();
  if (response.status !== 200) throw new Error(`搜索失败（${response.status}）`);
  return normalizeBraveResults(response.json);
}
