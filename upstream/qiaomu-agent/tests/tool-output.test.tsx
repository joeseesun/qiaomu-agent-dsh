// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToolOutput } from "../src/components/ui/code-block";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const raw = '\tfirst\n\n<script>literal</script>\n中文  two spaces\n';
function clipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  vi.spyOn(window.navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
  return writeText;
}
it("copies exact raw output without title or controls, and wraps without changing it", async () => {
  const write = clipboard();
  const { container } = render(<ToolOutput value={raw} />);
  const pre = container.querySelector("pre")!;
  expect(pre.textContent).toBe(raw);
  expect(container.querySelector("script")).toBeNull();
  expect(pre.tabIndex).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
  expect(pre.dataset.wrap).toBe("true");
  expect(screen.getByRole("button", { name: "自动换行" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
  await screen.findByRole("button", { name: "已复制输出" });
  expect(write).toHaveBeenCalledExactlyOnceWith(raw);
  expect(pre.textContent).toBe(raw);
});
it("shows clipboard failure and allows a successful retry", async () => {
  const write = clipboard(vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined));
  render(<ToolOutput value={raw} />);
  fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
  expect((await screen.findByRole("alert")).textContent).toContain("复制失败");
  fireEvent.click(screen.getByRole("button", { name: "重试复制输出" }));
  await screen.findByRole("button", { name: "已复制输出" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(write).toHaveBeenCalledTimes(2);
});
it("ignores a stale copy completion after streamed output changes", async () => {
  let finish!: () => void;
  clipboard(vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })));
  const { rerender } = render(<ToolOutput value="old" />);
  fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
  rerender(<ToolOutput value="new" />);
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByRole("button", { name: "已复制输出" })).toBeNull());
  expect(screen.getByRole("button", { name: "复制输出" }).hasAttribute("disabled")).toBe(false);
});
