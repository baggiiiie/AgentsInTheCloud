export {
  addWorkspaceTemplate,
  onWorkspaceTemplateStoreChanged,
  deleteWorkspaceTemplate,
  formatWorkspaceTemplateSpec,
  getWorkspaceTemplateConfiguration,
  isGitWorkspaceTemplateInit,
  workspaceTemplateIdFromInit,
  listWorkspaceTemplates,
  parseWorkspaceTemplateSpec,
  workspaceTemplatesFile,
  workspaceTemplateNameFromGitUrl,
  workspaceInitFromTemplate,
  updateWorkspaceTemplate,
  setWorkspaceTemplateDockerfile,
  setWorkspaceTemplatePrivileged,
  setWorkspaceTemplateSeedConfigEnabled,
  setWorkspaceTemplatePreloadImages,
  type AddWorkspaceTemplateResult,
  type DeleteWorkspaceTemplateResult,
  type GitWorkspaceTemplateInitInstruction,
  type WorkspaceTemplateConfiguration,
  type WorkspaceTemplateEnvironmentVariable,
  type WorkspaceTemplateListResult,
  type WorkspaceTemplateSecretSummary,
  type WorkspaceTemplateSshKeySummary,
  type WorkspaceTemplateSummary,
  type UpdateWorkspaceTemplateResult,
} from "./workspace-template.ts";

export {
  createWorkspaceTemplateSshKey,
  deleteWorkspaceTemplateSshKey,
  deriveWorkspaceTemplateSshPublicKey,
  listWorkspaceTemplateSshKeys,
  renameWorkspaceTemplateSshKey,
  revealWorkspaceTemplateSshKeys,
} from "./ssh-keys.ts";

export {
  createWorkspaceTemplateEnvironmentVariable,
  deleteWorkspaceTemplateEnvironmentVariable,
  listWorkspaceTemplateEnvironmentVariables,
  updateWorkspaceTemplateEnvironmentVariable,
} from "./environment.ts";

export {
  createWorkspaceTemplateSecret,
  deleteWorkspaceTemplateSecret,
  listWorkspaceTemplateSecrets,
  revealWorkspaceTemplateSecrets,
  updateWorkspaceTemplateSecret,
  secretNeedsValue,
  workspaceTemplateSecretPlaceholder,
  workspaceTemplateSecretPathPermissionSchema,
  type WorkspaceTemplateSecretInput,
  type WorkspaceTemplateSecretPlaintext,
} from "./secrets.ts";

export {
  clearGitIdentity,
  getGitIdentity,
  getStoredGitIdentity,
  gitIdentitySettingsFile,
  hasGitIdentity,
  registerGitIdentityWorkspaceEvents,
  setGitIdentity,
  type GitIdentitySettings,
} from "./git-identity.ts";

export {
  prepareWorkspaceSource,
  cachedWorkspaceTemplateSourcePath,
  workspaceTemplateDataDirKey,
  registerWorkspaceTemplateWorkspaceInitEvents,
  type PreparedWorkspaceSource,
} from "./workspace-source.ts";

export { registerWorkspaceTemplateWorkspaceEvents } from "./workspace-repos.ts";

export { getWorkspaceTemplateSshKnownHosts, setWorkspaceTemplateSshKnownHosts } from "./ssh-host-trust.ts";
export { sshHostTrustFailure, unknownSshHost, scanSshHost, trustScannedSshHost } from "./ssh-trust-recovery.ts";
export { onWorkspaceSshTrustChanged, workspaceSshTrustRequests, requestWorkspaceSshTrust, decideWorkspaceSshTrust, cancelWorkspaceSshTrust, type WorkspaceSshTrustRequest } from "./ssh-trust-broker.ts";
export { isSshAuthenticationFailure } from "./git-access-failure.ts";

export { workspaceTemplateSecretHosts, workspaceTemplateSecretAllowsPath } from "./secret-path-policy.ts";
