import { expect, test } from "bun:test";
import { parseGitNumstat, parseGitStatus } from "../src/git.ts";

test("numstat preserves literal tabs and newlines, renames, binary and empty files", () => {
  const stats = parseGitNumstat(Buffer.from("2\t1\tplain\0" + "3\t4\tfile\twith\nwhitespace\0" + "0\t0\t\0old\tname\0new\nname\0" + "-\t-\tbinary\0"));
  expect([...stats]).toEqual([
    ["plain", { additions: 2, deletions: 1 }],
    ["file\twith\nwhitespace", { additions: 3, deletions: 4 }],
    ["new\nname", { additions: 0, deletions: 0 }],
    ["binary", { additions: 0, deletions: 0, binary: true }],
  ]);
  expect(parseGitNumstat(Buffer.alloc(0)).size).toBe(0);
  expect(() => parseGitNumstat(Buffer.from("not numstat\0"))).toThrow("Invalid Git numstat response");
  expect(() => parseGitNumstat(Buffer.from("0\t0\t\0old\0"))).toThrow("Missing renamed path");
});

test("porcelain status preserves rename source and destination without splitting paths", () => {
  expect(parseGitStatus(Buffer.from("R  new\tpath\0old\npath\0?? untracked\npath\0 M modified\0"))).toEqual([
    { code: "R ", path: "new\tpath", previousPath: "old\npath" },
    { code: "??", path: "untracked\npath" },
    { code: " M", path: "modified" },
  ]);
  expect(parseGitStatus(Buffer.alloc(0))).toEqual([]);
});
