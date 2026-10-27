import { describe, expect, it } from "vitest";
import { parseCliOutputLine } from "../src/services/cli-output";

describe("parseCliOutputLine", () => {
  it("reads Antigravity streaming events and reports authentication errors", () => {
    expect(parseCliOutputLine('{"event":"step_update","step_update":{"text_delta":"OK"}}').text).toBe("OK");
    expect(parseCliOutputLine('{"event":"result","result":{"status":"SUCCESS","response":"OK"}}')).toMatchObject({ terminal: true, error: null });
    expect(parseCliOutputLine('{"event":"result","result":{"status":"ERROR","error":"authentication required"}}').error).toBe("authentication required");
  });
  it("reads Codex messages and completion", () => {
    expect(
      parseCliOutputLine('{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}')
    ).toMatchObject({ text: "OK", error: null, terminal: false });
    expect(parseCliOutputLine('{"type":"turn.completed"}').terminal).toBe(true);
  });

  it("turns Claude authentication events into failures", () => {
    const parsed = parseCliOutputLine(
      '{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}'
    );
    expect(parsed).toEqual({
      text: "",
      error: "Not logged in · Please run /login",
      terminal: true,
    });
  });

  it("recognizes zero-exit configuration failures", () => {
    expect(parseCliOutputLine("LLM not set")).toMatchObject({ text: "", error: "LLM not set" });
    expect(parseCliOutputLine("No API key found for the selected model.").error).toMatch(/API key/);
  });

  it("reads nested OpenCode text and Qwen errors", () => {
    expect(parseCliOutputLine('{"type":"text","part":{"text":"QIAOMU_OK"}}').text).toBe("QIAOMU_OK");
    expect(
      parseCliOutputLine(
        '{"type":"result","is_error":true,"error":{"message":"No auth type is selected"}}'
      ).error
    ).toBe("No auth type is selected");
  });
});
