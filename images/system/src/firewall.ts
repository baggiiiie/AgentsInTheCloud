import { isIP } from "node:net";
import { allowedEgressIpv6Range, blockedEgressIpv6Ranges, workspaceEgressNftIpv4Elements } from "../../../packages/shared/src/egress-policy.ts";

/** All bridge-attached workloads (including Docker builds and helper containers)
 * may reach only global unicast destinations. Match the kernel interface kind,
 * not bridge names: docker0, workspace bridges, and future/custom-named bridges
 * all share this boundary without registration or a network-creation race.
 * Host-side build clients use the same destination rules via their cgroup.
 * Only those clients get configured-DNS exceptions. The destination policy is
 * shared with the workspace egress proxy. */
export function workspaceFirewallRules(buildClientsCgroup: string, nameservers: string[]): string {
  const parts = buildClientsCgroup.split("/").filter(Boolean);
  if (!buildClientsCgroup.startsWith("/") || !parts.length || parts.some(part => part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/.test(part)))
    throw new Error("Invalid build client cgroup path");
  const dns = [...new Set(nameservers)].map(address => {
    const family = isIP(address);
    if (!family) throw new Error(`Invalid DNS server: ${address}`);
    return `    ${family === 4 ? "ip" : "ip6"} daddr ${address} meta l4proto { tcp, udp } th dport 53 counter accept`;
  }).join("\n");
  return `add table inet agents-in-the-cloud_workspaces
flush table inet agents-in-the-cloud_workspaces
table inet agents-in-the-cloud_workspaces {
  set non_public_v4 {
    type ipv4_addr; flags interval;
    elements = { ${workspaceEgressNftIpv4Elements()} }
  }
  chain public_egress {
${dns}
    jump public_destinations
  }
  chain public_destinations {
    fib daddr type local counter drop
    ip daddr @non_public_v4 counter drop
    ip6 daddr != ${allowedEgressIpv6Range.address}/${allowedEgressIpv6Range.prefix} counter drop
${blockedEgressIpv6Ranges.map(([address, prefix]) => `    ip6 daddr ${address}/${prefix} counter drop`).join("\n")}
  }
  chain output {
    type filter hook output priority -10; policy accept;
    socket cgroupv2 level ${parts.length} "${parts.join("/")}" jump public_egress
  }
  chain input {
    type filter hook input priority -10; policy accept;
    meta iifkind "bridge" ct state established,related counter accept
    meta iifkind "bridge" ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } counter accept
    meta iifkind "bridge" counter drop
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
    meta iifkind "bridge" meta oifkind "bridge" counter drop
    meta iifkind "bridge" jump public_destinations
  }
}
`;
}

/** Private DNS is allowed only at configured resolvers on TCP/UDP port 53. */
export function resolverAddresses(resolvConf: string): string[] {
  return resolvConf.split("\n").flatMap(line => {
    const match = /^\s*nameserver\s+(\S+)/.exec(line);
    return match ? [match[1]!] : [];
  });
}

export async function installWorkspaceFirewall(buildClientsCgroup: string, nameservers: string[]) {
  const rules = workspaceFirewallRules(buildClientsCgroup, nameservers);
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
