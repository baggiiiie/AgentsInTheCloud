import { afterEach, beforeEach, expect, test } from "bun:test";
import { addProject, createProjectSecret, listProjectSecrets, projectSecretRoutingRevision, revealProjectSecrets } from "@atelier/projects";
import { createTestApp, postJson, temporaryAtelierDataDir } from "./support/test-web-app.ts";

const data = temporaryAtelierDataDir();
beforeEach(data.setUp);
afterEach(data.tearDown);

test("secret API accepts boolean path permission and preserves omission", async () => {
  const { project } = await addProject("https://github.com/example/permissions.git");
  const { app } = createTestApp();
  const values = { envName: "TOKEN", hostPattern: "api.example.com" };
  const response = await app.fetch(postJson(`/projects/${project.id}/secrets`, { ...values, allowInPath: true }));
  expect(response.status).toBe(200);
  const { secret } = await response.json();
  expect(secret.allowInPath).toBe(true);
  const path = `/projects/${project.id}/secrets/${secret.id}`;
  expect((await (await app.fetch(postJson(path, values))).json()).secret.allowInPath).toBe(true);
  expect((await (await app.fetch(postJson(path, { ...values, allowInPath: false }))).json()).secret.allowInPath).toBe(false);
  for (const allowInPath of ["true", "auto", null, 1, {}]) {
    expect((await app.fetch(postJson(path, { ...values, allowInPath }))).status).toBe(400);
  }
  expect((await listProjectSecrets(project.id))[0]?.allowInPath).toBe(false);
});

test("form path permission persists and invalidates an earlier value-entry confirmation", async () => {
  const { project } = await addProject("https://github.com/example/permissions.git");
  const values = { envName: "TOKEN", hostPattern: "api.example.com" };
  const secret = await createProjectSecret(project.id, values);
  const { app } = createTestApp();
  const path = `/projects/${project.id}/secrets/${secret.id}`;
  const form = (allowInPath: string) => new Request(`http://test.local${path}`, { method: "POST", headers: { accept: "text/vnd.turbo-stream.html" }, body: new URLSearchParams({ ...values, allowInPath }) });
  expect((await app.fetch(form("true"))).status).toBe(200);
  expect((await listProjectSecrets(project.id))[0]?.allowInPath).toBe(true);
  expect((await app.fetch(postJson(`${path}/value`, { secretValue: "private", expectedRoutingRevision: projectSecretRoutingRevision(secret) }))).status).toBe(409);
  expect(await revealProjectSecrets(project.id)).toEqual([]);
  expect((await app.fetch(form("false"))).status).toBe(200);
  expect((await listProjectSecrets(project.id))[0]?.allowInPath).toBe(false);
  expect((await app.fetch(form("invalid"))).status).toBe(400);
  expect((await app.fetch(form(""))).status).toBe(400);
});

test("secret forms persist the displayed boolean choice even for known path-based APIs", async () => {
  const { project } = await addProject("https://github.com/example/default-permissions.git");
  const { app } = createTestApp();
  for (const [envName, hostPattern, allowInPath] of [
    ["BOT_TOKEN", "api.telegram.org", "true"],
    ["API_TOKEN", "api.example.com", "false"],
    ["DISABLED_BOT", "api.telegram.org", "false"],
  ] as const) {
    const response = await app.fetch(new Request(`http://test.local/projects/${project.id}/secrets`, {
      method: "POST", headers: { accept: "text/vnd.turbo-stream.html" },
      body: new URLSearchParams({ envName, hostPattern, allowInPath }),
    }));
    expect(response.status).toBe(200);
  }
  expect((await listProjectSecrets(project.id)).map(({ envName, allowInPath }) => ({ envName, allowInPath }))).toEqual([
    { envName: "API_TOKEN", allowInPath: false },
    { envName: "BOT_TOKEN", allowInPath: true },
    { envName: "DISABLED_BOT", allowInPath: false },
  ]);
});
