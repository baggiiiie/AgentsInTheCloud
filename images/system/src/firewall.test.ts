import { expect, test } from "bun:test";
import { resolverAddresses, workspaceFirewallRules } from "./firewall.ts";
import { blockedEgressIpv4Ranges, blockedEgressIpv6Ranges } from "../../../packages/shared/src/egress-policy.ts";

const dockerCgroup = "/system.slice/docker-example.scope/management/docker";

test("bridge and daemon egress share public-only enforcement", () => {
  const rules = workspaceFirewallRules([dockerCgroup, "/system.slice/docker-example.scope/workloads/build-clients"], ["127.0.0.11", "2001:4860:4860::8888"]);
  for (const bridge of ["atw-*", "docker0", "br-*"]) {
    expect(rules).toContain(`iifname "${bridge}" jump workload_input`);
    expect(rules).toContain(`iifname "${bridge}" jump workload_forward`);
    expect(rules).toContain(`oifname "${bridge}" counter drop`);
    expect(rules).toContain(`meta ibrname "${bridge}" counter drop`);
  }
  expect(rules).toContain('socket cgroupv2 level 4 "system.slice/docker-example.scope/management/docker" jump public_egress');
  expect(rules).toContain('socket cgroupv2 level 4 "system.slice/docker-example.scope/workloads/build-clients" jump public_egress');
  expect(rules).toContain("fib daddr type local counter drop");
  expect(rules).toContain("meta nfproto ipv6 ip6 daddr != 2000::/3 counter drop");
  for (const [address, prefix] of blockedEgressIpv4Ranges) expect(rules).toContain(`${address}/${prefix}`);
  for (const [address, prefix] of blockedEgressIpv6Ranges) expect(rules).toContain(`ip6 daddr ${address}/${prefix} counter drop`);
  expect(rules).toContain("ip daddr 127.0.0.11 meta l4proto { tcp, udp } th dport 53 counter accept");
  expect(rules).toContain("ip6 daddr 2001:4860:4860::8888 meta l4proto { tcp, udp } th dport 53 counter accept");
});

test("DNS exceptions are exact resolver IPs, deduplicated and limited to port 53", () => {
  const addresses = resolverAddresses("# resolver\nnameserver 127.0.0.11\n nameserver 127.0.0.11 # comment\nnameserver 2001:4860:4860::8888\nsearch example.com\n");
  expect(addresses).toEqual(["127.0.0.11", "127.0.0.11", "2001:4860:4860::8888"]);
  expect(workspaceFirewallRules([dockerCgroup, "/system.slice/docker-example.scope/workloads/build-clients"], addresses).match(/ip daddr 127\.0\.0\.11 /g)).toHaveLength(2); // input and shared egress
  expect(() => workspaceFirewallRules([dockerCgroup, "/system.slice/docker-example.scope/workloads/build-clients"], ["resolver.example.com"])).toThrow("Invalid DNS server");
});

test("reject invalid cgroup paths instead of interpolating nft commands", () => {
  expect(() => workspaceFirewallRules([], [])).toThrow("cgroups are required");
  for (const path of ["", "/", "relative/path", '/docker/";accept', "/docker/../daemon"]) {
    expect(() => workspaceFirewallRules([path], [])).toThrow("Invalid Docker cgroup path");
  }
});
