import { expect, test } from "bun:test";
import { getAgentsInTheCloudRuntimeContext } from "@agents-in-the-cloud/core";
import { resetAgentsInTheCloudRuntimeContextForTests } from "../src/runtime-context.ts";

test.skipIf(process.platform !== "darwin")("Docker containers reach a native macOS AgentsInTheCloud through host.docker.internal", () => {
  resetAgentsInTheCloudRuntimeContextForTests();
  expect(getAgentsInTheCloudRuntimeContext().dockerBridgeHost).toBe("host.docker.internal");
  resetAgentsInTheCloudRuntimeContextForTests();
});
