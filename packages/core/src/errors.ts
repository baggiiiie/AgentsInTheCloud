import type { JsonObject } from "./json.ts";

export interface AgentsInTheCloudError {
  code: string;
  message: string;
  details?: JsonObject;
}

export class AgentsInTheCloudCoreError extends Error {
  readonly code: string;
  readonly details?: JsonObject;

  constructor(code: string, message: string, details?: JsonObject) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function invalidArguments(message: string): AgentsInTheCloudCoreError {
  return new AgentsInTheCloudCoreError("invalid_arguments", message);
}
