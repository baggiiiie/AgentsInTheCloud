import { expect, test } from "bun:test";
import { getAgentsInTheCloudRuntimeContext, resetAgentsInTheCloudRuntimeContextForTests } from "@agents-in-the-cloud/core";

test.skipIf(process.platform !== "darwin")("Docker containers reach a native macOS AgentsInTheCloud through host.docker.internal", () => {
  resetAgentsInTheCloudRuntimeContextForTests();
  expect(getAgentsInTheCloudRuntimeContext().dockerBridgeHost).toBe("host.docker.internal");
  resetAgentsInTheCloudRuntimeContextForTests();
});
