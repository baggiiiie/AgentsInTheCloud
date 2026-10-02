#!/usr/bin/env bun
import { ensureDefaultWorkspaceImage } from "@agents-in-the-cloud/workspace-image";
if (process.argv.length !== 2) throw new Error("usage: bun scripts/ensure-workspace-image.ts (uses the selected Docker context)");
console.log(await ensureDefaultWorkspaceImage({ buildOutput: "inherit" }));
