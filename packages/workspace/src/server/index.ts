import { ensureSharedHome } from "../home.ts";
import { fileURLToPath } from "node:url";
import { prepareWorkspaceToolsMount } from "./workspace-tools.ts";
import { syncWorkspaceDocs } from "./workspace-docs.ts";
import {
  agentsInTheCloudDataPath,
  dockerHostAgentsInTheCloudDataPath,
  getAgentsInTheCloudRuntimeContext,
} from "@agents-in-the-cloud/core";
import type { WorkspaceModule } from "@agents-in-the-cloud/shared";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const docsMountPath = "/opt/agents-in-the-cloud/docs";

export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "workspace",
  async initialize({ events }) {
    await ensureSharedHome();
    const runtime = getAgentsInTheCloudRuntimeContext();
    await syncWorkspaceDocs(repositoryRoot, agentsInTheCloudDataPath(runtime, "docs"));
    const toolsMount = await prepareWorkspaceToolsMount(runtime);
    events.on("workspace_plan_prepare", ({ plan }) => {
      plan.mounts.push(toolsMount);
      if (plan.mounts.some((mount) => mount.target === docsMountPath)) return;
      plan.mounts.push({
        type: "bind",
        source: dockerHostAgentsInTheCloudDataPath(runtime, "docs"),
        target: docsMountPath,
        readonly: true,
      });
    });
  },
};
