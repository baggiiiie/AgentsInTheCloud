import { existsSync } from "node:fs";
import { publicWorkspaceAppOrigin } from "@agents-in-the-cloud/proxy-ingress/server";
/** Normal AgentsInTheCloud authentication is applied by the app before module dispatch.
 * Parent ingress translates same-origin requests to the local app origin and
 * attests that decision. Public routing metadata is not the translated Origin. */
export function hostOriginAllowed(request: Request, parentConnected = existsSync("/run/agents-in-the-cloud-parent")): boolean {
  const origin = request.headers.get("origin");
  const attestedOrigin = request.headers.get("x-agents-in-the-cloud-origin-context");
  if (parentConnected && attestedOrigin !== null) {
    // An explicit "null" includes foreign origins that happen to match localhost.
    return attestedOrigin !== "null" && origin === attestedOrigin;
  }
  return origin === new URL(publicWorkspaceAppOrigin(request)).origin;
}
