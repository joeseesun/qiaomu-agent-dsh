import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ getLanguage: vi.fn(() => "en") }));
import { getLanguage } from "obsidian";
import { connectionText } from "../src/i18n/connection";
import { validateApiUrl } from "../src/services/api-providers";

describe("private HTTP consent localization", () => {
  it("uses English for both the notice and blocked-save feedback", () => {
    expect(connectionText("privateHttpNotice")).toContain("unencrypted HTTP");
    expect(connectionText("privateHttpAllow")).toBe("Allow HTTP for this local network address");
    expect(() => validateApiUrl("http://192.168.1.20")).toThrow(connectionText("privateHttpRequired"));
  });
  it("follows the existing Chinese fallback without changing stored URLs", () => {
    vi.mocked(getLanguage).mockReturnValue("zh");
    expect(connectionText("privateHttpAllow")).toBe("允许在此局域网地址上使用 HTTP");
    expect(validateApiUrl("http://192.168.1.20", true)).toBe("http://192.168.1.20");
  });
});
