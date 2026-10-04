import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceTemplateRoutes } from "../../../apps/web/src/server/workspace-template-routes.ts";
import { addWorkspaceTemplate, getWorkspaceTemplateConfiguration } from "../src/workspace-template.ts";

test("privilege API defaults off, accepts explicit booleans and does not mutate on invalid input", async () => {
  const previous = process.env.ATELIER_DATA_DIR;
  const directory = await mkdtemp(join(tmpdir(), "workspace-template-privilege-api-"));
  process.env.ATELIER_DATA_DIR = directory;
  try {
    const { workspaceTemplate } = await addWorkspaceTemplate("/tmp/example");
    const routes = createWorkspaceTemplateRoutes({
      referencingWorkspaces: () => [],
      invalidatePresentation: () => {},
      createAgentWorkspace: async () => new Response(),
    });
    const url = new URL(`http://localhost/workspace-templates/${workspaceTemplate.id}/privileged`);
    const request = (privileged: boolean | string | number | null | Record<string, never> | undefined) => new Request(url, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ privileged }),
    });
    expect((await getWorkspaceTemplateConfiguration(workspaceTemplate.id)).privileged).toBe(false);
    const response = await routes.handle(request(true), url);
    expect(response!.status).toBe(200);
    expect((await response!.json()).workspaceTemplate.privileged).toBe(true);
    for (const invalid of [null, "true", 1, {}, undefined]) {
      await expect(routes.handle(request(invalid), url)).rejects.toThrow("privileged must be a boolean");
    }
    expect((await getWorkspaceTemplateConfiguration(workspaceTemplate.id)).privileged).toBe(true);
    await routes.handle(request(false), url);
    expect((await getWorkspaceTemplateConfiguration(workspaceTemplate.id)).privileged).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.ATELIER_DATA_DIR;
    else process.env.ATELIER_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
