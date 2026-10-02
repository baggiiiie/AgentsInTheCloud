import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProject, createProjectSecret, listProjectSecrets, projectSecretAllowsPath, projectSecretRoutingRevision, updateProjectSecret } from "../src/index.ts";

test("default path permission requires exact known hosts, never broad wildcards or mixed destinations", () => {
  for (const hostPattern of ["api.telegram.org", " API.Telegram.Org ; api.telegram.org "]) {
    expect(projectSecretAllowsPath({ hostPattern })).toBe(true);
    expect(projectSecretAllowsPath({ hostPattern, allowInPath: false })).toBe(false);
  }
  for (const hostPattern of ["", "github.com", "api.github.com", "telegram.org", "*.telegram.org", "*", "api.telegram.org.evil.test", "api.telegram.org, github.com", "https://api.telegram.org"]) {
    expect(projectSecretAllowsPath({ hostPattern })).toBe(false);
    expect(projectSecretAllowsPath({ hostPattern, allowInPath: true })).toBe(true);
  }
});

test("path overrides persist, omitted updates preserve them, and older files get hostname defaults", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agents-in-the-cloud-path-permissions-"));
  const file = join(directory, "projects.json");
  try {
    const { project } = await addProject("https://github.com/example/permissions.git", file);
    const values = { envName: "BOT_TOKEN", hostPattern: "api.telegram.org" };
    const secret = await createProjectSecret(project.id, values, file);
    const revision = projectSecretRoutingRevision(secret);
    expect(secret.allowInPath).toBe(true);
    const disabled = await updateProjectSecret(project.id, secret.id, { ...values, allowInPath: false }, file);
    expect(projectSecretRoutingRevision(disabled)).not.toBe(revision);
    await updateProjectSecret(project.id, secret.id, { ...values, annotation: "Keep permission" }, file);
    expect((await listProjectSecrets(project.id, file))[0]?.allowInPath).toBe(false);
    const enabled = await updateProjectSecret(project.id, secret.id, { ...values, allowInPath: true }, file);
    expect(enabled.allowInPath).toBe(true);
    expect(projectSecretRoutingRevision(enabled)).toBe(revision);
    const store = JSON.parse(await readFile(file, "utf8"));
    delete store.projects[0].secrets[0].allowInPath;
    await writeFile(file, JSON.stringify(store));
    expect(projectSecretAllowsPath((await listProjectSecrets(project.id, file))[0]!)).toBe(true);
    await updateProjectSecret(project.id, secret.id, { ...values, hostPattern: "github.com" }, file);
    expect(projectSecretAllowsPath((await listProjectSecrets(project.id, file))[0]!)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
