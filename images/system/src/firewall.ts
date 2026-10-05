import { allowedEgressIpv6Range, blockedEgressIpv6Ranges, workspaceEgressNftIpv4Elements } from "../../../packages/shared/src/egress-policy.ts";
import { isIP } from "node:net";

const workloadBridges = ["atw-*", "docker0", "br-*"];

/** Docker RUN uses bridges; remote ADD, registry and build proxy traffic can
 * originate in dockerd; registry authentication can originate in the CLI.
 * All paths must enforce the same public-only policy. */
export function workspaceFirewallRules(buildEgressCgroups: string[], nameservers: string[]): string {
  if (!buildEgressCgroups.length) throw new Error("Build egress cgroups are required");
  const outputRules = buildEgressCgroups.map(parent => {
    const cgroup = parent.split("/").filter(Boolean);
    if (!parent.startsWith("/") || !cgroup.length || cgroup.some(part => part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/.test(part))) throw new Error("Invalid Docker cgroup path");
    return `    socket cgroupv2 level ${cgroup.length} "${cgroup.join("/")}" jump public_egress`;
  }).join("\n");
  const dns = [...new Set(nameservers)].map(address => {
    const family = isIP(address);
    if (!family) throw new Error(`Invalid DNS server: ${address}`);
    return `    ${family === 4 ? "ip" : "ip6"} daddr ${address} meta l4proto { tcp, udp } th dport 53 counter accept`;
  }).join("\n");
  return `add table inet agents-in-the-cloud_workspaces
flush table inet agents-in-the-cloud_workspaces
add table bridge agents-in-the-cloud_workspaces
flush table bridge agents-in-the-cloud_workspaces
table inet agents-in-the-cloud_workspaces {
  set non_public_v4 {
    type ipv4_addr; flags interval;
    elements = { ${workspaceEgressNftIpv4Elements()} }
  }
  chain public_egress {
${dns}
    fib daddr type local counter drop
    ip daddr @non_public_v4 counter drop
    meta nfproto ipv6 ip6 daddr != ${allowedEgressIpv6Range.address}/${allowedEgressIpv6Range.prefix} counter drop
${blockedEgressIpv6Ranges.map(([address, prefix]) => `    ip6 daddr ${address}/${prefix} counter drop`).join("\n")}
  }
  chain workload_input {
    ct state established,related counter accept
${dns}
    ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } counter accept
    counter drop
  }
  chain input {
    type filter hook input priority -10; policy accept;
${workloadBridges.map(bridge => `    iifname "${bridge}" jump workload_input`).join("\n")}
  }
  chain workload_forward {
${workloadBridges.map(bridge => `    oifname "${bridge}" counter drop`).join("\n")}
    jump public_egress
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
${workloadBridges.map(bridge => `    iifname "${bridge}" jump workload_forward`).join("\n")}
  }
  chain output {
    type filter hook output priority -10; policy accept;
${outputRules}
  }
}
table bridge agents-in-the-cloud_workspaces {
  chain forward {
    type filter hook forward priority -10; policy accept;
${workloadBridges.map(bridge => `    meta ibrname "${bridge}" counter drop`).join("\n")}
  }
}
`;
}

/** DNS is the only private-network exception, restricted to configured resolver
 * addresses on TCP/UDP port 53. Resolution never authorizes the resulting IP. */
export function resolverAddresses(resolvConf: string): string[] {
  return resolvConf.split("\n").flatMap(line => {
    const match = /^\s*nameserver\s+(\S+)/.exec(line);
    return match ? [match[1]!] : [];
  });
}

export async function installWorkspaceFirewall(buildEgressCgroups: string[], nameservers: string[]) {
  const rules = workspaceFirewallRules(buildEgressCgroups, nameservers);
  // Atomic batch replacement touches only our tables; Docker NAT/filter rules survive.
  const process = Bun.spawn(["nft", "-f", "-"], {
    stdin: new TextEncoder().encode(rules), stdout: "pipe", stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([
    process.exited, new Response(process.stdout).text(), new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Could not install workspace firewall: ${error || output}`);
}
