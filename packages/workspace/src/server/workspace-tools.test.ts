import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWorkspaceToolsMount } from "./workspace-tools.ts";

test("combines package tools into one read-only executable directory and synchronizes changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "atelier-tools-mount-"));
  try {
    const source = join(root, "packages");
    const firstPackage = join(source, "first-package/workspace_tools");
    const secondPackage = join(source, "second-package/workspace_tools");
    await mkdir(firstPackage, { recursive: true });
    await mkdir(secondPackage, { recursive: true });
    await mkdir(join(source, "no-tools"));
    await writeFile(join(source, "not-a-package"), "ignored");
    await writeFile(join(firstPackage, "first"), "#!/bin/sh\necho first\n");
    await writeFile(join(secondPackage, "second"), "#!/bin/sh\necho second\n");
    const runtime = { atelierDataDir: join(root, "data"), dockerHostAtelierDataDir: "/host/atelier", dockerBridgeHost: "unused" };
    const mount = await prepareWorkspaceToolsMount(runtime, source);
    expect(mount).toEqual({
      type: "bind",
      source: "/host/atelier/workspace-tools",
      target: "/opt/atelier/bin",
      readonly: true,
    });
    const published = join(runtime.atelierDataDir, "workspace-tools");
    const inode = (await stat(published)).ino;
    for (const name of ["first", "second"]) {
      expect(await readFile(join(published, name), "utf8")).toBe(await readFile(join(name === "first" ? firstPackage : secondPackage, name), "utf8"));
      expect((await stat(join(published, name))).mode & 0o777).toBe(0o755);
    }
    await writeFile(join(firstPackage, "first"), "#!/bin/sh\necho updated\n");
    await rm(join(secondPackage, "second"));
    await writeFile(join(secondPackage, "third"), "#!/bin/sh\necho third\n");
    expect(await prepareWorkspaceToolsMount(runtime, source)).toEqual(mount);
    expect((await stat(published)).ino).toBe(inode);
    expect(await readFile(join(published, "first"), "utf8")).toContain("updated");
    expect(await Bun.file(join(published, "second")).exists()).toBe(false);
    expect(await readFile(join(published, "third"), "utf8")).toContain("third");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includes the agent bash helper in the shared tools directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "atelier-tools-mount-"));
  try {
    await prepareWorkspaceToolsMount({ atelierDataDir: root, dockerHostAtelierDataDir: root, dockerBridgeHost: "unused" });
    expect(await readFile(join(root, "workspace-tools/atelier-agent-bash"), "utf8"))
      .toBe(await readFile(new URL("../../../agent/workspace_tools/atelier-agent-bash", import.meta.url), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("rejects duplicate tool names before changing the published directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "atelier-tools-conflict-"));
  try {
    const packages = join(root, "packages");
    const first = join(packages, "one/workspace_tools/shared");
    const second = join(packages, "two/workspace_tools/shared");
    for (const name of ["one", "two"]) {
      await mkdir(join(packages, name, "workspace_tools"), { recursive: true });
    }
    await writeFile(first, "first");
    const runtime = { atelierDataDir: join(root, "data"), dockerHostAtelierDataDir: "/host/atelier", dockerBridgeHost: "unused" };
    await prepareWorkspaceToolsMount(runtime, packages);
    await writeFile(first, "updated");
    await writeFile(second, "conflict");
    await expect(prepareWorkspaceToolsMount(runtime, packages)).rejects.toThrow(
      `Conflicting workspace tool "shared": ${first} and ${second}`,
    );
    expect(await readFile(join(runtime.atelierDataDir, "workspace-tools/shared"), "utf8")).toBe("first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
