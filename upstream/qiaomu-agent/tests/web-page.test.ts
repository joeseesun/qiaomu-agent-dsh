import { describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { checkedWebUrl, extractFeedText, extractWebText } from "../src/services/web-page";

describe("public webpage reading", () => {
  it.each(["obsidian://qiaomu-ai-rss/open", "file:///etc/passwd", "http://localhost/page", "http://127.0.0.1/page", "https://localhost/page", "https://[::1]/page", "https://user:pass@example.com/"])("rejects unsafe URL %s", (input) => {
    expect(() => checkedWebUrl(input)).toThrow();
  });
  it("keeps a public HTTPS URL", () => {
    expect(checkedWebUrl("https://www.bensbites.com/p/example").href).toBe("https://www.bensbites.com/p/example");
    expect(checkedWebUrl("http://example.com/feed.xml").href).toBe("http://example.com/feed.xml");
  });
  it("extracts article text without navigation, scripts, or footer", () => {
    vi.stubGlobal("DOMParser", new Window().DOMParser);
    expect(extractWebText("<html><head><title>Article</title></head><body><nav>Menu</nav><article><h1>Heading</h1><p>The content.</p><script>Ignore me</script></article><footer>Footer</footer></body></html>"))
      .toEqual({ title: "Article", text: "HeadingThe content." });
    vi.unstubAllGlobals();
  });
  it("extracts RSS titles, links, and summaries", () => {
    vi.stubGlobal("DOMParser", new Window().DOMParser);
    expect(extractFeedText("<rss><channel><title>News</title><item><title>One</title><link>https://example.com/one</link><description>Summary</description></item></channel></rss>"))
      .toEqual({ title: "News", text: "One — https://example.com/one — Summary" });
    vi.unstubAllGlobals();
  });
});
