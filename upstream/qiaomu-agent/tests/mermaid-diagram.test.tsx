// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ mount: vi.fn(), renderHost: vi.fn(), destroy: vi.fn(), zoomBy: vi.fn(), reset: vi.fn(), language: "zh" }));
vi.mock("obsidian", () => ({ getLanguage: () => mock.language }));
vi.mock("../src/services/pele-diagram", () => ({
  supportsPele: (source: string) => source.startsWith("flowchart"),
  isDiagramLimit: (error: { code?: string }) => error?.code === "limit",
  mountPeleDiagram: mock.mount,
}));
vi.mock("../src/services/host-mermaid", () => ({
  MAX_MERMAID_SOURCE: 20_000,
  renderMermaidSvg: mock.renderHost,
  sizeSvg: (svg: string) => ({ svg, width: 320 }),
  svgDataUrl: (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`,
}));
import { MermaidDiagram } from "../src/ui/mermaid-diagram";
beforeEach(() => {
  vi.clearAllMocks(); mock.language = "zh";
  mock.mount.mockImplementation((_el, _source, callbacks) => { callbacks.onRender(); return { destroy: mock.destroy, zoom: { zoomBy: mock.zoomBy, reset: mock.reset } }; });
  mock.renderHost.mockResolvedValue('<svg viewBox="0 0 320 200"></svg>');
});
afterEach(cleanup);
it("keeps source intact and provides accessible zoom controls with cleanup", async () => {
  const source = "flowchart LR\n A[中文] --> B[结果]";
  const view = render(<MermaidDiagram source={source} />);
  fireEvent.click(await screen.findByRole("button", { name: "放大图表" }));
  expect(mock.zoomBy).toHaveBeenCalledWith(1.25);
  fireEvent.click(screen.getByRole("button", { name: "适应宽度" }));
  expect(mock.reset).toHaveBeenCalledOnce();
  expect(view.container.querySelector("pre")?.textContent).toBe(source);
  expect(mock.renderHost).not.toHaveBeenCalled();
  view.unmount(); expect(mock.destroy).toHaveBeenCalledOnce();
});
it("falls back on parse failures and renders unsupported types as inert images", async () => {
  mock.mount.mockImplementation((_el, _source, callbacks) => { callbacks.onError(new Error("unsupported syntax")); return { destroy: mock.destroy }; });
  const view = render(<MermaidDiagram source={"flowchart TD\nA["} />);
  expect((await screen.findByRole("img", { name: "Mermaid 图表" })).getAttribute("src")).toMatch(/^data:image\/svg\+xml,/);
  expect(mock.renderHost).toHaveBeenCalledWith("flowchart TD\nA[", "default");
  view.rerender(<MermaidDiagram source={'pie\n "中文" : 1'} />);
  await waitFor(() => expect(mock.renderHost).toHaveBeenLastCalledWith('pie\n "中文" : 1', "default"));
});
it("does not bypass source or renderer limits with Mermaid fallback", async () => {
  mock.mount.mockImplementation((_el, _source, callbacks) => { callbacks.onError({ code: "limit" }); return { destroy: mock.destroy }; });
  const view = render(<MermaidDiagram source={"flowchart TD\n A --> B"} />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "图表过大，请减少节点、连线或源码长度。");
  expect(mock.renderHost).not.toHaveBeenCalled();
  view.rerender(<MermaidDiagram source={"x".repeat(20_001)} />);
  expect(mock.mount).toHaveBeenCalledTimes(1);
  expect(view.container.querySelector("details")?.open).toBe(true);
});
it("ignores a late host render after a source replacement", async () => {
  let resolve!: (svg: string) => void;
  mock.renderHost.mockImplementation(() => new Promise<string>((done) => { resolve = done; }));
  const view = render(<MermaidDiagram source={'pie\n "旧" : 1'} />);
  await waitFor(() => expect(mock.renderHost).toHaveBeenCalled());
  view.rerender(<MermaidDiagram source={"flowchart LR\n A --> B"} />);
  await act(async () => resolve("<svg>stale</svg>"));
  expect(view.container.querySelector("img")).toBeNull();
  expect(view.container.querySelector(".qa-mermaid")?.getAttribute("data-renderer")).toBe("pele");
});
it("opens the source and shows a recovery message when both renderers fail", async () => {
  mock.renderHost.mockRejectedValue(new Error("invalid"));
  const view = render(<MermaidDiagram source="invalid diagram" />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "图表未能显示，请检查源码或缩小图表。");
  expect(view.container.querySelector("details")?.open).toBe(true);
});
it("localizes diagram controls without changing user source", async () => {
  mock.language = "en";
  const view = render(<MermaidDiagram source={"flowchart TD\n A[用户笔记]"} />);
  expect(await screen.findByRole("button", { name: "Zoom in" })).toBeTruthy();
  expect(screen.getByText("Diagram source")).toBeTruthy();
  expect(view.container.querySelector("pre")?.textContent).toContain("用户笔记");
});
