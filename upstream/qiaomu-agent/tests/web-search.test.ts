import { describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { normalizeBraveResults, searchWeb } from "../src/services/web-search";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

describe("search results", () => {
  it("keeps bounded, linked results and ignores malformed entries", () => {
    expect(normalizeBraveResults({ web: { results: [
      { title: "News", url: "https://example.com/story", description: "Fresh   report" },
      { title: "Bad", url: "javascript:alert(1)" },
      { url: "http://example.org" },
    ] } })).toEqual([
      { title: "News", url: "https://example.com/story", snippet: "Fresh report" },
      { title: "http://example.org", url: "http://example.org", snippet: "" },
    ]);
  });
  it("sends the query and key only to Brave's fixed search endpoint", async () => {
    vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { web: { results: [{ title: "A", url: "https://example.com", description: "B" }] } } } as Awaited<ReturnType<typeof requestUrl>>);
    expect(await searchWeb("latest news", "secret", new AbortController().signal)).toEqual([{ title: "A", url: "https://example.com", snippet: "B" }]);
    expect(vi.mocked(requestUrl).mock.calls[0]![0]).toMatchObject({
      url: "https://api.search.brave.com/res/v1/web/search?q=latest%20news&count=6",
      headers: { "X-Subscription-Token": "secret", Accept: "application/json" },
    });
  });
});
