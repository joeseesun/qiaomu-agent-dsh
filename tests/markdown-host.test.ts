// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import DOMPurify from "dompurify";
import { Component, MarkdownRenderer, sanitizeHTMLToDom, TFile } from "../src/client/obsidian";

describe("original Markdown host boundary", () => {
  it("renders original message content with headings, tables, code and wiki aliases", async () => {
    const target = document.createElement("div");
    await MarkdownRenderer.render({}, '# 标题\n\n[[笔记|别名]]\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`', target, "", new Component());
    expect(target.querySelector("h1")?.textContent).toBe("标题");
    expect(target.querySelector("table")).not.toBeNull();
    expect(target.querySelector("code")?.textContent).toBe("code");
    expect(target.querySelector(".internal-link")?.getAttribute("data-href")).toBe("笔记");
    expect(target.querySelector(".internal-link")?.textContent).toBe("别名");
  });
  it("removes scripts, event handlers and javascript URLs from model-produced HTML", async () => {
    const target = document.createElement("div");
    await MarkdownRenderer.render({}, '<script>danger()</script><img src="x" onerror="danger()"><a href="javascript:danger()">bad</a>', target, "", new Component());
    expect(target.querySelector("script,[onerror],[href^='javascript:']")).toBeNull();
  });
  it("escapes wiki labels and attributes before sanitization", async () => {
    const target = document.createElement("div");
    await MarkdownRenderer.render({}, '[[note" onmouseover="danger()|<img src=x onerror=danger()>]]', target, "", new Component());
    expect(target.querySelector("img,[onmouseover],[onerror]")).toBeNull();
    expect(target.querySelector("a")?.textContent).toBe("<img src=x onerror=danger()>");
  });
  it("resolves relative images through the scoped vault and protects external links", async () => {
    const target = document.createElement("div"), file = new TFile("folder/image.png");
    await MarkdownRenderer.render({ metadataCache: { getFirstLinkpathDest: () => file }, vault: { getResourcePath: () => "blob:local-image" } }, '![cover](image.png) [web](https://example.com)', target, "folder/note.md", new Component());
    expect(target.querySelector("img")?.getAttribute("src")).toBe("blob:local-image");
    expect(target.querySelector("a")?.rel).toContain("noopener");
  });
  it("does not commit an asynchronous render after its original component unloads", async () => {
    const target = document.createElement("div"), component = new Component();
    target.textContent = "kept";
    const rendering = MarkdownRenderer.render({}, "replacement", target, "", component);
    component.unload();
    await rendering;
    expect(target.textContent).toBe("kept");
  });
  it("retains inert SVG geometry used by the original Pele diagrams", () => {
    const fragment = sanitizeHTMLToDom('<svg viewBox="0 0 20 20"><script>danger()</script><path d="M0 0L20 20" onclick="danger()"/></svg>');
    expect(fragment.querySelector("path")).not.toBeNull();
    expect(fragment.querySelector("script,[onclick]")).toBeNull();
  });
  it("refuses raw HTML when the sanitizer cannot run in the current environment", async () => {
    const original = DOMPurify.isSupported;
    Object.defineProperty(DOMPurify, "isSupported", { value: false, configurable: true, writable: true });
    try {
      expect(() => sanitizeHTMLToDom("<img onerror=danger()>" )).toThrow("safe HTML");
      const target = document.createElement("div");
      await expect(MarkdownRenderer.render({}, "<img onerror=danger()>", target, "", new Component())).rejects.toThrow("safe Markdown");
      expect(target.childNodes.length).toBe(0);
    } finally { Object.defineProperty(DOMPurify, "isSupported", { value: original, configurable: true, writable: true }); }
  });
});
