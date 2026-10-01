import type { WorkspaceModule } from "@atelier/shared";
import { preserveLegacySubagentHistories } from "./history-store.ts";

// Live delegation is paused during the Pi Durable port. Keep only history
// preservation, so workspace cleanup cannot destroy older child transcripts.
export const atelierServerModule: WorkspaceModule = {
  id: "subagent-history",
  async initialize() {
    await preserveLegacySubagentHistories();
  },
};
