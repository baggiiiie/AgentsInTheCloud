import { requireDocker, type JsonObject } from "@agents-in-the-cloud/core";
import { readJsonSettings } from "@agents-in-the-cloud/core/json-settings";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const protectedBuildSchema = Type.Object({
  workloadsCgroupParent: Type.String({ minLength: 1 }),
  buildClientsCgroupParent: Type.String({ minLength: 1 }),
  buildNetworkPolicy: Type.Object({ version: Type.Literal(1), daemonId: Type.String({ minLength: 1 }) }),
});
type ProtectedBuildResources = Static<typeof protectedBuildSchema>;
export const systemDockerHost = "unix:///var/run/docker.sock";

export function parseProtectedBuildResources(resources: JsonObject): ProtectedBuildResources {
  if (!Value.Check(protectedBuildSchema, resources)) throw new Error("Repository Dockerfile builds require a System with public-internet-only build networking. Update System or use a prebuilt workspace image; unrestricted builds are disabled.");
  return resources;
}

/** No native-Docker or old-System fallback for repository-controlled Dockerfiles. */
export async function repositoryBuildNetworkArgs(): Promise<string[]> {
  const resources = parseProtectedBuildResources(await readJsonSettings("/run/agents-in-the-cloud-system/resources.json"));
  const daemon = await requireDocker(["--host", systemDockerHost, "info", "--format", "{{.ID}}"]);
  return protectedBuildArgs(resources, daemon.stdout.trim());
}

export function protectedBuildArgs(resources: ProtectedBuildResources, daemonId: string): string[] {
  if (resources.buildNetworkPolicy.daemonId !== daemonId) throw new Error("Docker daemon does not match System's build network policy; refusing an unrestricted repository build.");
  return ["--builder", "default", "--network=default", "--cgroup-parent", resources.workloadsCgroupParent];
}

/** Docker's session auth provider and credential-helper children also fetch URLs
 * selected by registry responses. Migrate this CLI before it can open sockets. */
export function repositoryBuildCommand(args: string[]): string[] {
  return ["sh", "-ec", 'echo $$ > /run/agents-in-the-cloud-system/build-client-processes/cgroup.procs; exec "$@"', "agents-in-the-cloud-build", "docker", ...args];
}
