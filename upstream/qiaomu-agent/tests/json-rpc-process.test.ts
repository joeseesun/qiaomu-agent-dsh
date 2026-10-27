import { describe, expect, it } from "vitest";
import { splitJsonLines } from "../src/services/json-rpc-process";

describe("splitJsonLines", () => {
  it("keeps an incomplete JSON line between chunks", () => {
    const first = splitJsonLines("", '{"id":1}\n{"meth');
    expect(first.lines).toEqual(['{"id":1}']);
    expect(first.rest).toBe('{"meth');
    const second = splitJsonLines(first.rest, 'od":"update"}\r\n');
    expect(second.lines).toEqual(['{"method":"update"}']);
    expect(second.rest).toBe("");
  });
});
