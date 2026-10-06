import { expect, test } from "bun:test";
import { workspaceFirewallRules } from "./firewall.ts";

test("all bridge kinds share the input and forwarding boundary, independent of names", () => {
  const rules = workspaceFirewallRules();
  expect(rules).not.toContain("iifname");
  expect(rules).not.toContain("oifname");
  expect(rules).toContain('meta iifkind "bridge" counter drop');
  expect(rules).toContain('meta iifkind "bridge" meta oifkind "bridge" counter drop');
  expect(rules).toContain('meta iifkind "bridge" ip daddr @non_public_v4 counter drop');
  expect(rules).toContain('meta iifkind "bridge" ip6 daddr != 2000::/3 counter drop');
  expect(rules).toContain('meta iifkind "bridge" ip6 daddr 2001:db8::/32 counter drop');
});

test("preserves host-initiated replies and IPv6 neighbor discovery before the input deny", () => {
  const rules = workspaceFirewallRules();
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
