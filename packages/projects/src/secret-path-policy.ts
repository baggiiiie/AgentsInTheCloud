// Exact hosts only: broad wildcards or mixed destinations must opt in explicitly.
export const secretPathInjectionDefaultHosts: readonly string[] = ["api.telegram.org"];

export function projectSecretHosts(pattern: string): string[] {
  return [...new Set(pattern.split(/[,;]/).map((host) => host.trim().toLowerCase()).filter(Boolean))];
}

export function projectSecretAllowsPath(secret: { hostPattern: string; allowInPath?: boolean }): boolean {
  if (secret.allowInPath !== undefined) return secret.allowInPath;
  const hosts = projectSecretHosts(secret.hostPattern);
  return hosts.length > 0 && hosts.every(host => secretPathInjectionDefaultHosts.includes(host));
}
