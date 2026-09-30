import { expect, test } from "bun:test";
import { requireTailscaleHttps, TailscaleHttpsDisabledError } from "./tailscale.ts";

test("HTTPS requires certificate eligibility for this node, not just a DNS name", () => {
  for (const domains of [undefined, null, [], ["other.tailnet.ts.net"]]) {
    expect(() => requireTailscaleHttps("atelier.tailnet.ts.net", domains)).toThrow(TailscaleHttpsDisabledError);
    expect(() => requireTailscaleHttps("atelier.tailnet.ts.net", domains)).toThrow("https://login.tailscale.com/admin/dns");
  }
  requireTailscaleHttps("atelier.tailnet.ts.net.", ["atelier.tailnet.ts.net"]);
});
