import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { JsonObject } from "@agents-in-the-cloud/core";
import { parseProtectedBuildResources, protectedBuildArgs, repositoryBuildCommand, repositoryBuildNetworkArgs } from "./build-network.ts";

const resources = { workloadsCgroupParent: "/system/workloads", buildClientsCgroupParent: "/system/workloads/build-clients", buildNetworkPolicy: { version: 1 as const, daemonId: "protected-daemon" } };

test("repository builds select integrated default networking on the protected daemon", () => {
  expect(protectedBuildArgs(resources, "protected-daemon")).toEqual([
    "--builder", "default", "--network=default", "--cgroup-parent", "/system/workloads",
  ]);
});

test("another Docker daemon cannot borrow System's network attestation", () => {
  for (const id of ["", "another-daemon"]) expect(() => protectedBuildArgs(resources, id)).toThrow("does not match");
});

test.skipIf(existsSync("/run/agents-in-the-cloud-system/resources.json"))("native Docker has no unrestricted repository-build fallback", async () => {
  // This unit-test environment has no installed System; fail before invoking Docker.
  await expect(repositoryBuildNetworkArgs()).rejects.toThrow("unrestricted builds are disabled");
});

test("old System, absent and malformed attestations cannot authorize builds", () => {
  const configurations: JsonObject[] = [
    {}, { workloadsCgroupParent: "/system/workloads" },
    { workloadsCgroupParent: "/system/workloads", buildClientsCgroupParent: "/system/workloads/build-clients", buildNetworkPolicy: { version: 0, daemonId: "daemon" } },
    { workloadsCgroupParent: "/system/workloads", buildClientsCgroupParent: "/system/workloads/build-clients", buildNetworkPolicy: { version: 1, daemonId: "" } },
  ];
  for (const config of configurations) expect(() => parseProtectedBuildResources(config)).toThrow("unrestricted builds are disabled");
  expect(parseProtectedBuildResources(resources)).toEqual(resources);
});

test("the repository CLI migrates before exec and has no unfiltered fallback", () => {
  expect(repositoryBuildCommand(["--host", "unix:///var/run/docker.sock", "build", "--network=default", "/context"])).toEqual([
    "sh", "-ec", 'echo $$ > /run/agents-in-the-cloud-system/build-client-processes/cgroup.procs; exec "$@"',
    "agents-in-the-cloud-build", "docker", "--host", "unix:///var/run/docker.sock", "build", "--network=default", "/context",
  ]);
});
