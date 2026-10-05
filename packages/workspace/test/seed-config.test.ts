import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorkspaceTemplate, createWorkspaceTemplateSecret, createWorkspaceTemplateSshKey, revealWorkspaceTemplateSecrets, revealWorkspaceTemplateSshKeys } from "@agents-in-the-cloud/workspace-templates";
import type { WorkspaceDockerPlan } from "../src/types.ts";
import { applySeedConfigManifest } from "../src/seed-config.ts";

let directory: string;
let host: string;
let nested: string;
let bin: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "workspace-seeded-config-"));
  host = join(directory, "host");
  nested = join(directory, "nested");
  bin = join(directory, "bin");
  await mkdir(host);
  await mkdir(bin);
  // Run the actual install script without requiring root or a local service user.
  await writeFile(join(bin, "su"), '#!/bin/sh\nexec /bin/sh -c "$5" "$6" "$7"\n');
  await writeFile(join(bin, "install"), '#!/bin/sh\ncp "$7" "$8"\nchmod 600 "$8"\n');
  await chmod(join(bin, "su"), 0o755);
  await chmod(join(bin, "install"), 0o755);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function seedPlan(projectsJson = join(nested, "projects.json")): Promise<WorkspaceDockerPlan> {
  const plan: WorkspaceDockerPlan = { preloadImages: [], labels: {}, env: {}, mounts: [], extraArgs: [], initScripts: [], containerFiles: [], cleanup: [] };
  await applySeedConfigManifest({ version: 1, seedAgentsInTheCloudConfig: { projectsJson } }, plan, {
    agentsInTheCloudDataDir: host, dockerHostAgentsInTheCloudDataDir: host, dockerBridgeHost: "127.0.0.1",
  });
  return plan;
}

async function installPlan(plan: WorkspaceDockerPlan): Promise<void> {
  const staging = join(directory, "staging");
  await mkdir(staging);
  for (const file of plan.containerFiles) await copyFile(file.source, file.target.replace("/.agents-in-the-cloud", staging));
  const script = plan.initScripts.join("\n").replaceAll("/.agents-in-the-cloud", staging);
  for (let boot = 0; boot < 2; boot++) {
    const process = Bun.spawn(["sh", "-eu", "-c", script], { env: { ...Bun.env, PATH: `${bin}:${Bun.env.PATH}` }, stderr: "pipe" });
    const stderr = await new Response(process.stderr).text();
    expect({ exitCode: await process.exited, stderr }).toEqual({ exitCode: 0, stderr: "" });
  }
}

test("seeding a catalogue also seeds its encryption key so nested secrets and SSH keys work", async () => {
  const catalogue = join(host, "projects.json");
  const key = join(host, "project-secrets.key");
  const template = (await addWorkspaceTemplate("https://github.com/example/fixture.git", catalogue)).workspaceTemplate;
  await createWorkspaceTemplateSecret(template.id, { envName: "API_TOKEN", hostPattern: "api.example.com", secretValue: "fixture-token" }, catalogue, key);
  const privateKeyFile = join(directory, "id_ed25519");
  expect(await Bun.spawn(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", privateKeyFile]).exited).toBe(0);
  const privateKey = await readFile(privateKeyFile, "utf8");
  await createWorkspaceTemplateSshKey(template.id, privateKey, catalogue, key);

  const plan = await seedPlan();
  await installPlan(plan);
  const nestedKey = join(nested, "project-secrets.key");
  expect((await stat(nestedKey)).mode & 0o777).toBe(0o600);
  expect(await revealWorkspaceTemplateSecrets(template.id, join(nested, "projects.json"), nestedKey)).toMatchObject([{ secretValue: "fixture-token" }]);
  expect(await revealWorkspaceTemplateSshKeys(template.id, join(nested, "projects.json"), nestedKey)).toEqual([privateKey]);
});

test("a host with no encrypted values does not need an encryption key", async () => {
  await addWorkspaceTemplate("https://github.com/example/fixture.git", join(host, "projects.json"));
  const plan = await seedPlan();
  expect(plan.containerFiles).toHaveLength(1);
  await installPlan(plan);
  expect(await Bun.file(join(nested, "project-secrets.key")).exists()).toBe(false);
});

test("the paired key follows custom catalogue destinations", async () => {
  await writeFile(join(host, "project-secrets.key"), "fixture");
  const destination = join(nested, "custom", "catalogue.json");
  const plan = await seedPlan(destination);
  expect(plan.initScripts[1]).toContain(join(nested, "custom", "project-secrets.key"));
});

test("a manifest without catalogue seeding does not copy the host encryption key", async () => {
  await writeFile(join(host, "project-secrets.key"), "fixture");
  const plan: WorkspaceDockerPlan = { preloadImages: [], labels: {}, env: {}, mounts: [], extraArgs: [], initScripts: [], containerFiles: [], cleanup: [] };
  await applySeedConfigManifest({ version: 1 }, plan, { agentsInTheCloudDataDir: host, dockerHostAgentsInTheCloudDataDir: host, dockerBridgeHost: "127.0.0.1" });
  expect(plan.containerFiles).toEqual([]);
});
