import { expect, test } from "bun:test";
import { resolverAddresses, workspaceFirewallRules } from "./firewall.ts";

test("all bridge kinds share the input and forwarding boundary, independent of names", () => {
  const rules = workspaceFirewallRules("/system/workloads/build-clients", ["127.0.0.53"]);
  expect(rules).not.toContain("iifname");
  expect(rules).not.toContain("oifname");
  expect(rules).toContain('meta iifkind "bridge" counter drop');
  expect(rules).toContain('meta iifkind "bridge" meta oifkind "bridge" counter drop');
  expect(rules).toContain('meta iifkind "bridge" jump public_destinations');
  expect(rules).toContain('ip daddr @non_public_v4 counter drop');
  expect(rules).toContain('ip6 daddr != 2000::/3 counter drop');
  expect(rules).toContain('ip6 daddr 2001:db8::/32 counter drop');
});

test("preserves host-initiated replies and IPv6 neighbor discovery before the input deny", () => {
  const rules = workspaceFirewallRules("/system/workloads/build-clients", ["127.0.0.53"]);
  const deny = rules.indexOf('meta iifkind "bridge" counter drop');
  for (const exception of [
    'meta iifkind "bridge" ct state established,related counter accept',
    'meta iifkind "bridge" ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } counter accept',
  ]) {
    expect(rules).toContain(exception);
    expect(rules.indexOf(exception)).toBeLessThan(deny);
  }
  // Only our table is replaced: Docker's NAT/filtering and ingress stay intact.
  expect(rules).toStartWith("add table inet agents-in-the-cloud_workspaces\nflush table inet agents-in-the-cloud_workspaces\n");
  expect(rules).not.toContain("flush ruleset");
});

test("build-client sockets are confined without affecting management sockets", () => {
  const rules = workspaceFirewallRules("/system/workloads/build-clients", ["127.0.0.53"]);
  expect(rules).toContain('socket cgroupv2 level 3 "system/workloads/build-clients" jump public_egress');
  expect(rules).toContain("fib daddr type local counter drop");
  expect(rules).toContain("ip daddr @non_public_v4 counter drop");
  expect(rules).toContain("ip daddr 127.0.0.53 meta l4proto { tcp, udp } th dport 53 counter accept");
  const output = rules.slice(rules.indexOf("  chain public_egress"), rules.indexOf("  chain input"));
  expect(output).not.toContain("ct state");
  expect(output).toContain("jump public_destinations");
  for (const path of ["", "/", "relative", "/system/../management", '/system/"injection'])
    expect(() => workspaceFirewallRules(path, [])).toThrow("Invalid build client cgroup");
  expect(() => workspaceFirewallRules("/system/build-clients", ["invalid"])).toThrow("Invalid DNS");
});

test("DNS exceptions are limited to build clients, not forwarded workloads", () => {
  const nameservers = resolverAddresses("# resolver config\nnameserver 127.0.0.53\n nameserver fd00::53 # IPv6\nsearch example.com\n");
  expect(nameservers).toEqual(["127.0.0.53", "fd00::53"]);
  const rules = workspaceFirewallRules("/system/workloads/build-clients", nameservers);
  expect(rules).toContain("ip6 daddr fd00::53 meta l4proto { tcp, udp } th dport 53 counter accept");
  const forward = rules.slice(rules.indexOf("  chain forward"));
  expect(forward).toContain('meta iifkind "bridge" jump public_destinations');
  expect(forward).not.toContain("jump public_egress");
});
