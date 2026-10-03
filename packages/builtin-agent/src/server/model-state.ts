import { configuredModelOptionViews } from "@agents-in-the-cloud/agent/server/model-state";

export async function hasAvailableBuiltinAgentModel(): Promise<boolean> {
  return (await configuredModelOptionViews()).some((model) => model.available);
}
