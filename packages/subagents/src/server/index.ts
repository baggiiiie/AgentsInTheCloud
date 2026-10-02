import type { WorkspaceModule } from "@agents-in-the-cloud/shared";
import { preserveLegacySubagentHistories } from "./history-store.ts";

// Live delegation is paused during the Pi Durable port. Keep only history
// preservation, so workspace cleanup cannot destroy older child transcripts.
export const agentsInTheCloudServerModule: WorkspaceModule = {
  id: "subagent-history",
  async initialize() {
    await preserveLegacySubagentHistories();
  },
};
