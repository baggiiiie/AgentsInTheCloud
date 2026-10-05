import { enabledModelOptionViews } from "@agents-in-the-cloud/agent/server/model-state";

export async function hasAvailableBuiltinAgentModel(): Promise<boolean> {
  return (await enabledModelOptionViews()).some((model) => model.available);
}
