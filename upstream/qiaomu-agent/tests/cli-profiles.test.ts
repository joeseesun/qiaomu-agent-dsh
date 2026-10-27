import { describe, expect, it } from "vitest";
import { getCliProfile } from "../src/services/cli-profiles";
import type { ChatRequest } from "../src/types";

function request(permissionMode: "plan" | "edit" | "full"): ChatRequest {
  return {
    prompt: "Hello",
    systemPrompt: "System",
    cwd: "/vault",
    permissionMode,
    history: [],
  };
}

describe("CLI profiles", () => {
  it("keeps Gemini headless and read-only without unsupported flags", () => {
    const args = getCliProfile("gemini")?.buildArgs(request("plan"));
    expect(args).toContain("--skip-trust");
    expect(args).toContain("plan");
    expect(args).not.toContain("--system-prompt");
  });

  it("gives Pi read tools in plan mode and disables implicit skills", () => {
    const args = getCliProfile("pi")?.buildArgs(request("plan"));
    expect(args).toContain("--no-skills");
    expect(args).toContain("read,grep,find,ls");
    expect(args).not.toContain("--no-tools");
  });
});

it("maps Codex full access to its explicit full-filesystem sandbox", () => {
  expect(getCliProfile("codex")?.buildArgs(request("full"))).toEqual(expect.arrayContaining(["--sandbox", "danger-full-access"]));
});
