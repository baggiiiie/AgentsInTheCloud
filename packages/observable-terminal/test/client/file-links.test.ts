import { expect, test } from "bun:test";
import { terminalFileUri, terminalTextFileAt } from "../../src/client/file-links.ts";

test("OSC 8 file destinations retain position and reject remote or non-file links", () => {
  expect(terminalFileUri("file:///work/src/a%20b.ts?line=42&column=3")).toEqual({ path: "/work/src/a b.ts", line: 42, column: 3 });
  expect(terminalFileUri("file://localhost/work/a.ts#L9C2")).toEqual({ path: "/work/a.ts", line: 9, column: 2 });
  expect(terminalFileUri("file://other-host/work/a.ts")).toBeUndefined();
  expect(terminalFileUri("https://example.com/a.ts")).toBeUndefined();
  expect(terminalFileUri("file:///work/%00bad.ts")).toBeUndefined();
});

test("plain references require a file-shaped path and preserve line and column", () => {
  expect(terminalTextFileAt("Look at src/example.ts:42:3, then", 13)).toEqual({ path: "src/example.ts", line: 42, column: 3 });
  expect(terminalTextFileAt("/work/a.ts:7", 7)).toEqual({ path: "/work/a.ts", line: 7, column: undefined });
  expect(terminalTextFileAt("https://example.com", 9)).toBeUndefined();
  expect(terminalTextFileAt("hello world", 2)).toBeUndefined();
});
