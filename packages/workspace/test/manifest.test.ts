import { describe, expect, test } from "bun:test";
import { AtelierCoreError, type JsonObject } from "@atelier/core";
import { parseRepoWorkspaceManifest } from "@atelier/workspace";

function parse(value: JsonObject) { return parseRepoWorkspaceManifest(JSON.stringify(value)); }
function expectInvalid(value: JsonObject, text: string): void {
  try { parse(value); } catch (error) {
    expect(error).toBeInstanceOf(AtelierCoreError);
    if (!(error instanceof AtelierCoreError)) throw error;
    expect(error.message).toContain(text);
    return;
  }
  throw new Error("expected invalid manifest");
}

describe("workspace manifest config seeding", () => {
  test("accepts Pi and Atelier config destinations", () => {
    expect(parse({
      version: 1,
      seedPiConfig: { authJson: "/nested/auth.json", modelsJson: "/nested/models.json", modelsStoreJson: "/nested/models-store.json" },
      seedAtelierConfig: { projectsJson: "/nested/projects.json" },
    })).toEqual({
      version: 1,
      seedPiConfig: { authJson: "/nested/auth.json", modelsJson: "/nested/models.json", modelsStoreJson: "/nested/models-store.json" },
      seedAtelierConfig: { projectsJson: "/nested/projects.json" },
    });
  });

  test("rejects malformed Pi catalogue cache destinations", () => {
    for (const modelsStoreJson of ["", "   ", true, 42]) {
      expectInvalid({ version: 1, seedPiConfig: { modelsStoreJson } }, "seedPiConfig.modelsStoreJson must be a non-empty string");
    }
  });

  test("rejects malformed Atelier config destinations", () => {
    expectInvalid({ version: 1, seedAtelierConfig: true }, "seedAtelierConfig must be an object");
    expectInvalid({ version: 1, seedAtelierConfig: { projectsJson: "" } }, "seedAtelierConfig.projectsJson must be a non-empty string");
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
  test("rejects removed repository-controlled Docker settings", () => {
    expect(parse({ version: 1 })).toEqual({ version: 1 });
    const removedSettings: JsonObject[] = [{}, { privileged: true }, { privileged: false }, { privileged: "true" }];
    for (const docker of removedSettings) {
      expectInvalid({ version: 1, docker }, "docker settings are no longer supported; use Project settings");
    }
  });

  test("rejects removed special-purpose fields", () => {
    expectInvalid({ version: 1, isAtelier: true }, "isAtelier is no longer supported");
    expectInvalid({ version: 1, privileged: true }, "privileged is no longer supported");
  });
});
