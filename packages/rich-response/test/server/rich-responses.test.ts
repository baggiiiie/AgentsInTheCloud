import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { richResponseMaxBytes, validateRichResponse } from "../../src/server/rich-responses.ts";
import { richFrameMessage, richThemeMessage } from "../../src/shared/rich-response-protocol.ts";

describe("rich response fragments", () => {
  test("rejects full documents, empty files and oversized UTF-8 input", () => {
    expect(validateRichResponse("<html><body>Page</body></html>")).toHaveProperty("error");
    expect(validateRichResponse("   ")).toHaveProperty("error");
    expect(validateRichResponse("é".repeat(richResponseMaxBytes))).toHaveProperty("error");
    expect(validateRichResponse("<section>Fragment</section>")).toEqual({ html: "<section>Fragment</section>" });
  });
});

describe("untrusted frame protocol", () => {
  test("rejects invalid sizes and unsupported capabilities", () => {
    expect(Value.Check(richFrameMessage, { type: "size", height: -2, overflow: false })).toBe(false);
    expect(Value.Check(richFrameMessage, { type: "size", height: Infinity, overflow: false })).toBe(false);
    expect(Value.Check(richFrameMessage, { type: "size", height: 360, overflow: false })).toBe(true);
    expect(Value.Check(richFrameMessage, { type: "execute", command: "anything" })).toBe(false);
    expect(Value.Check(richFrameMessage, { type: "link", href: "javascript:alert(1)" })).toBe(false);
    expect(Value.Check(richThemeMessage, { type: "theme", theme: "nord", fontSize: "16px" })).toBe(true);
    expect(Value.Check(richThemeMessage, { type: "theme", theme: "nord", fontSize: "url(https://example.com)" })).toBe(false);
  });
});
