/** Internal links in rendered replies: where they point and how they read. */

/** The vault link text behind a rendered internal link, or null for anything else. */
export function internalLinkTarget(anchor: Element): string | null {
  if (!anchor.classList.contains("internal-link")) return null;
  const target = anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
  if (!target) return null;
  try { return decodeURI(target); } catch { return target; }
}

/** "40 Resources/乌鸦的习性.md#习性" reads as "乌鸦的习性 › 习性"; the full path stays in the link target. */
export function linkLabel(target: string): string {
  const [path = "", ...rest] = target.split("#");
  const name = path.split("/").pop()!.replace(/\.md$/i, "");
  const heading = rest.join("#").replace(/^\^/, "");
  return name && heading ? `${name} › ${heading}` : name || heading || target;
}

/** Shorten links the model wrote as bare paths; aliases the model chose are left alone. */
export function tidyInternalLinks(root: HTMLElement): void {
  for (const anchor of Array.from(root.querySelectorAll("a.internal-link"))) {
    const target = internalLinkTarget(anchor);
    const text = anchor.textContent ?? "";
    if (target && (text === target || text === anchor.getAttribute("href"))) anchor.textContent = linkLabel(target);
  }
}
