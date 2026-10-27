import { parse } from "yaml";
import { Lexer, walkTokens } from "marked";
/** Use Markdown tokens, so code examples and escaped characters never become real tags/backlinks. */
export function noteMetadata(text) {
  let body = text,
    frontmatter = {};
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(
    text,
  );
  if (match) {
    try {
      const value = parse(match[1], { maxAliasCount: 20 });
      if (value && typeof value === "object" && !Array.isArray(value))
        frontmatter = value;
    } catch {}
    body = text.slice(match[0].length);
  }
  const tags = [],
    links = [],
    headings = [];
  walkTokens(Lexer.lex(body), (token) => {
    if (token.type === "link") links.push({ link: token.href });
    if (token.type === "heading")
      headings.push({ heading: token.text, level: token.depth });
    if (token.type !== "text" || token.tokens?.length) return;
    for (const match of token.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu))
      tags.push({ tag: "#" + match[1] });
    for (const match of token.text.matchAll(
      /!?\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g,
    ))
      links.push({ link: match[1] });
  });
  return { frontmatter, tags, links, headings };
}
