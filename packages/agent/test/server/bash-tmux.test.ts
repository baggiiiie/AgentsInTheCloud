import { expect, test } from "bun:test";
import { formatBashOutput } from "../../src/server/bash-tmux.ts";

test("returns plain model output from rendered pane while storing colored pane output", () => {
  const pane = "\u001b[31mred\u001b[0m\nPane is dead\n";

  const result = formatBashOutput(pane, pane, "/tmp/full.log");

  expect(result.output).toBe("red");
  expect(result.displayAnsi).toBe("\u001b[31mred\u001b[0m");
  expect(result.displayAnsi).not.toContain("Pane is dea");
});

test("preserves leading whitespace in model and display output", () => {
  const pane = "   indented output\nPane is dead\n";

  const result = formatBashOutput(pane, pane, "/tmp/full.log");

  expect(result.output).toBe("   indented output");
  expect(result.displayAnsi).toBe("   indented output");
});

test("uses tmux rendered pane output for dotnet-style terminal UI output", () => {
  const paneText = [
    "Restore succeeded with 3 warning(s) in 1.1s",
    "  LanguageModels succeeded (0.4s) → LanguageModels/bin/Debug/net9.0/LanguageModels.dll",
    "  ProfessionalReportServer succeeded (0.6s) → ProfessionalReportServer/bin/Debug/net9.0/ProfessionalReportServer.dll",
    "",
    "Build succeeded with 6 warning(s) in 3.1s",
  ].join("\n");
  const pane = `\u001b[32m${paneText}\u001b[0m\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");

  expect(result.output).toBe(paneText);
  expect(result.displayAnsi).toContain("\u001b[32mRestore succeeded");
  expect(result.displayAnsi).not.toContain("Pane is dea");
});

test("uses rendered tmux capture for carriage-return progress output", () => {
  const rendered = "Cloning into 'repo'...\nremote: Counting objects: 100% (94/94)";
  const pane = `${rendered}\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");

  expect(result.output).toBe(rendered);
  expect(result.displayAnsi).toBe(rendered);
});

test("formats 100 captured lines without truncation", () => {
  const plainLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const ansiLines = plainLines.map((line) => `\u001b[32m${line}\u001b[0m`);
  const pane = `${ansiLines.join("\n")}\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");

  expect(result.output).toBe(plainLines.join("\n"));
  expect(result.displayAnsi.split("\n")).toHaveLength(100);
  expect(result.displayAnsi).toStartWith("\u001b[32mline 1\u001b[0m");
  expect(result.displayAnsi).toEndWith("\u001b[32mline 100\u001b[0m");
  expect(result.displayAnsi).not.toContain("Pane is dea");
});

test("keeps the tail within Pi's 50 KiB and 2000-line model limits", () => {
  const lines = Array.from({ length: 2100 }, (_, index) => String(index + 1).padStart(4, "0"));
  const pane = `${lines.join("\n")}\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");
  const output = result.output;

  expect(output).toStartWith(lines[100]);
  expect(output).not.toContain(lines[99]);
  expect(output).toContain(lines[2099]);
  expect(output).toContain("[Output truncated: showing the last");
  expect(output).toContain(`Full output: ${"/tmp/full.log"}]`);
  expect(result.displayAnsi).toEndWith(output.slice(output.indexOf("[Output truncated:")));
});

test("limits model-facing output to the last 50 KiB", () => {
  const lines = Array.from({ length: 700 }, (_, index) => `${String(index + 1).padStart(4, "0")}:${"x".repeat(90)}`);
  const pane = `${lines.join("\n")}\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");
  const output = result.output;

  expect(Buffer.byteLength(output)).toBeLessThan(52 * 1024);
  expect(output).not.toContain(lines[0]);
  expect(output).toContain(lines[699]);
  expect(output).toContain("[Output truncated: showing the last 50.0KB of output");
});

test("shortens individual model-facing lines to 500 characters and retains the full output path", () => {
  const longLine = "a".repeat(700);
  const pane = `${longLine}\nPane is dead\n`;

  const result = formatBashOutput(pane, pane, "/tmp/full.log");
  const output = result.output;

  expect(output).toStartWith(`${"a".repeat(500)}... [truncated]`);
  expect(output).toContain("1 line shortened to 500 characters");
  expect(output).toContain(`Full output: ${"/tmp/full.log"}]`);
  expect(result.displayAnsi).toEndWith(output.slice(output.indexOf("[Output truncated:")));
});
