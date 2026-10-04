import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createAgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { addWorkspaceTemplate, createWorkspaceTemplateEnvironmentVariable, workspaceInitFromTemplate, registerWorkspaceTemplateWorkspaceInitEvents, setWorkspaceTemplatePreloadImages } from "@agents-in-the-cloud/workspace-templates";
import type { WorkspaceDockerPlan } from "@agents-in-the-cloud/workspace";

describe("project environment", () => {
  let previousDataDir: string | undefined;
  let dataDir: string;

  beforeEach(async () => {
    previousDataDir = process.env.ATELIER_DATA_DIR;
    dataDir = await mkdtemp(`${tmpdir()}/agents-in-the-cloud-workspace-template-environment-`);
    process.env.ATELIER_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.ATELIER_DATA_DIR;
    else process.env.ATELIER_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("adds saved variables to project workspace container plans", async () => {
    const workspaceTemplate = (await addWorkspaceTemplate("https://github.com/org/repo.git")).workspaceTemplate;
    await createWorkspaceTemplateEnvironmentVariable(workspaceTemplate.id, { name: "API_URL", value: "https://api.example.com" });
    await createWorkspaceTemplateEnvironmentVariable(workspaceTemplate.id, { name: "EMPTY", value: "" });
    await setWorkspaceTemplatePreloadImages(workspaceTemplate.id, ["docker.io/library/postgres:17"]);
    const events = createAgentsInTheCloudEventBus();
    registerWorkspaceTemplateWorkspaceInitEvents(events);
    const plan: WorkspaceDockerPlan = { labels: {}, env: {}, mounts: [], preloadImages: [], extraArgs: [], initScripts: [], containerFiles: [], cleanup: [] };

    await events.emit("workspace_plan_prepare", { workspaceId: "workspace", init: workspaceInitFromTemplate(workspaceTemplate), workHostPath: "/tmp/work", workContainerPath: "/work", plan });

    expect(plan.env).toEqual({ API_URL: "https://api.example.com", EMPTY: "" });
    expect(plan.preloadImages).toEqual(["docker.io/library/postgres:17"]);
    await setWorkspaceTemplatePreloadImages(workspaceTemplate.id, ["docker.io/library/redis:8"]);
    expect(plan.preloadImages).toEqual(["docker.io/library/postgres:17"]);
  });
});
