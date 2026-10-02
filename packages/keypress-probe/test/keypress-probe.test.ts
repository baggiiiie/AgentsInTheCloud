import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentsInTheCloudServerModule } from "../src/server/index.ts";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.ATELIER_DATA_DIR;
  dataDir = await mkdtemp(join(tmpdir(), "agents-in-the-cloud-keypress-probe-test-"));
  process.env.ATELIER_DATA_DIR = dataDir;
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.ATELIER_DATA_DIR;
  else process.env.ATELIER_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("keypress probe settings", () => {
  test("renders and updates explicit Off and On choices", async () => {
    const settings = agentsInTheCloudServerModule.settingsContributions![0]!;
    const initial = await settings.render();
    expect(initial).toContain('role="group" aria-label="Keylogging probe"');
    expect(initial).toMatch(/<button(?=[^>]*value="false")(?=[^>]*aria-pressed="true")[^>]*>Off<\/button>/);
    expect(initial).toMatch(/<button(?=[^>]*value="true")(?=[^>]*aria-pressed="false")[^>]*>On<\/button>/);

    const enabledBody = new FormData();
    enabledBody.set("enabled", "true");
    const enabledResponse = await settings.handleAction!({
      request: new Request("http://test/settings/keypress-probe", { method: "POST", body: enabledBody }),
      url: new URL("http://test/settings/keypress-probe"),
    });
    expect(await enabledResponse!.text()).toMatch(/<button(?=[^>]*value="true")(?=[^>]*aria-pressed="true")[^>]*>On<\/button>/);

    const disabledBody = new FormData();
    disabledBody.set("enabled", "false");
    const disabledResponse = await settings.handleAction!({
      request: new Request("http://test/settings/keypress-probe", { method: "POST", body: disabledBody }),
      url: new URL("http://test/settings/keypress-probe"),
    });
    expect(await disabledResponse!.text()).toMatch(/<button(?=[^>]*value="false")(?=[^>]*aria-pressed="true")[^>]*>Off<\/button>/);
  });
});
