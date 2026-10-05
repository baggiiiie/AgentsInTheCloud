import { allowedEgressIpv6Range, blockedEgressIpv6Ranges, workspaceEgressNftIpv4Elements } from "../../../packages/shared/src/egress-policy.ts";

/** Workspaces may reach only global unicast destinations; one table covers current
 * and future workspace bridges, independent of Docker's rules. The element list
 * comes from the shared egress policy, the same one the workspace egress proxy
 * enforces, so the two layers cannot drift apart. */
export function workspaceFirewallRules(): string {
  return `add table inet agents-in-the-cloud_workspaces
flush table inet agents-in-the-cloud_workspaces
table inet agents-in-the-cloud_workspaces {
  set non_public_v4 {
    type ipv4_addr; flags interval;
    elements = { ${workspaceEgressNftIpv4Elements()} }
  }
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "atw-*" ct state established,related counter accept
    iifname "atw-*" ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } counter accept
    iifname "atw-*" counter drop
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "atw-*" oifname "atw-*" counter drop
    iifname "atw-*" ip daddr @non_public_v4 counter drop
    iifname "atw-*" ip6 daddr != ${allowedEgressIpv6Range.address}/${allowedEgressIpv6Range.prefix} counter drop
${blockedEgressIpv6Ranges.map(([address, prefix]) => `    iifname "atw-*" ip6 daddr ${address}/${prefix} counter drop`).join("\n")}
  }
}
`;
}

export async function installWorkspaceFirewall() {
  const rules = workspaceFirewallRules();
  // Atomic batch replacement touches only our table; Docker NAT/filter rules survive.
  const process = Bun.spawn(["nft", "-f", "-"], {
    stdin: new TextEncoder().encode(rules),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`Could not install workspace firewall: ${error || output}`);
}
