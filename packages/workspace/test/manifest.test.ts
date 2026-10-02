import { describe, expect, test } from "bun:test";
import { AgentsInTheCloudCoreError, type JsonObject } from "@agents-in-the-cloud/core";
import { parseRepoWorkspaceManifest } from "@agents-in-the-cloud/workspace";

function parse(value: JsonObject) { return parseRepoWorkspaceManifest(JSON.stringify(value)); }
function expectInvalid(value: JsonObject, text: string): void {
  try { parse(value); } catch (error) {
    expect(error).toBeInstanceOf(AgentsInTheCloudCoreError);
    if (!(error instanceof AgentsInTheCloudCoreError)) throw error;
    expect(error.message).toContain(text);
    return;
  }
  throw new Error("expected invalid manifest");
}

describe("workspace manifest config seeding", () => {
  test("accepts Pi and AgentsInTheCloud config destinations", () => {
    expect(parse({
      version: 1,
      seedPiConfig: { authJson: "/nested/auth.json", modelsJson: "/nested/models.json", modelsStoreJson: "/nested/models-store.json" },
      seedAgentsInTheCloudConfig: { projectsJson: "/nested/projects.json" },
    })).toEqual({
      version: 1,
      seedPiConfig: { authJson: "/nested/auth.json", modelsJson: "/nested/models.json", modelsStoreJson: "/nested/models-store.json" },
      seedAgentsInTheCloudConfig: { projectsJson: "/nested/projects.json" },
    });
  });

  test("rejects malformed Pi catalogue cache destinations", () => {
    for (const modelsStoreJson of ["", "   ", true, 42]) {
      expectInvalid({ version: 1, seedPiConfig: { modelsStoreJson } }, "seedPiConfig.modelsStoreJson must be a non-empty string");
    }
  });

  test("rejects malformed AgentsInTheCloud config destinations", () => {
    expectInvalid({ version: 1, seedAgentsInTheCloudConfig: true }, "seedAgentsInTheCloudConfig must be an object");
    expectInvalid({ version: 1, seedAgentsInTheCloudConfig: { projectsJson: "" } }, "seedAgentsInTheCloudConfig.projectsJson must be a non-empty string");
  });
});

describe("workspace manifest init scripts", () => {
  test("accepts only arrays of strings", () => {
    expect(parse({ version: 1, initScripts: ["bun install", "bun test"] }).initScripts).toEqual(["bun install", "bun test"]);
    expectInvalid({ version: 1, initScripts: "bun install" }, "initScripts must be an array of strings");
    expectInvalid({ version: 1, initScripts: ["bun install", 42] }, "initScripts must be an array of strings");
  });
});

describe("workspace manifest Docker configuration", () => {
  test("accepts optional Docker privilege", () => {
    expect(parse({ version: 1 })).toEqual({ version: 1 });
    expect(parse({ version: 1, docker: {} }).docker).toEqual({});
    for (const privileged of [true, false]) {
      expect(parse({ version: 1, docker: { privileged } }).docker).toEqual({ privileged });
    }
  });

  test("rejects a non-boolean Docker privilege", () => {
    expectInvalid({ version: 1, docker: { privileged: "true" } }, "docker.privileged must be a boolean");
  });

  test("rejects removed special-purpose fields", () => {
    expectInvalid({ version: 1, isAgentsInTheCloud: true }, "isAgentsInTheCloud is no longer supported");
    expectInvalid({ version: 1, privileged: true }, "privileged is no longer supported");
  });
});
