import { ensureSharedHome } from "../home.ts";
import { fileURLToPath } from "node:url";
import { prepareWorkspaceToolsMount } from "./workspace-tools.ts";
import { syncWorkspaceDocs } from "./workspace-docs.ts";
import {
  atelierDataPath,
  dockerHostAtelierDataPath,
  getAtelierRuntimeContext,
} from "@atelier/core";
import type { WorkspaceModule } from "@atelier/shared";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const docsMountPath = "/opt/atelier/docs";

export const atelierServerModule: WorkspaceModule = {
  id: "workspace",
  async initialize({ events }) {
    await ensureSharedHome();
    const runtime = getAtelierRuntimeContext();
    await syncWorkspaceDocs(repositoryRoot, atelierDataPath(runtime, "docs"));
    const toolsMount = await prepareWorkspaceToolsMount(runtime);
    events.on("workspace_plan_prepare", ({ plan }) => {
      plan.mounts.push(toolsMount);
      if (plan.mounts.some((mount) => mount.target === docsMountPath)) return;
      plan.mounts.push({
        type: "bind",
        source: dockerHostAtelierDataPath(runtime, "docs"),
        target: docsMountPath,
        readonly: true,
      });
    });
  },
};
