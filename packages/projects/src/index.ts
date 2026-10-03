export {
  addProject,
  onProjectStoreChanged,
  deleteProject,
  formatProjectSpec,
  getProjectConfiguration,
  isGitProjectInit,
  listProjects,
  parseProjectSpec,
  projectsFile,
  projectNameFromGitUrl,
  projectWorkspaceInit,
  updateProject,
  setProjectDockerfile,
  setProjectPrivileged,
  setProjectPreloadImages,
  type AddProjectResult,
  type DeleteProjectResult,
  type GitProjectInitInstruction,
  type ProjectConfiguration,
  type ProjectEnvironmentVariable,
  type ProjectListResult,
  type ProjectSecretSummary,
  type ProjectSshKeySummary,
  type ProjectSummary,
  type UpdateProjectResult,
} from "./project.ts";

export {
  createProjectSshKey,
  deleteProjectSshKey,
  deriveProjectSshPublicKey,
  listProjectSshKeys,
  renameProjectSshKey,
  revealProjectSshKeys,
} from "./ssh-keys.ts";

export {
  createProjectEnvironmentVariable,
  deleteProjectEnvironmentVariable,
  listProjectEnvironmentVariables,
  updateProjectEnvironmentVariable,
} from "./environment.ts";

export {
  createProjectSecret,
  deleteProjectSecret,
  listProjectSecrets,
  revealProjectSecrets,
  updateProjectSecret,
  secretNeedsValue,
  projectSecretPlaceholder,
  projectSecretPathPermissionSchema,
  type ProjectSecretInput,
  type ProjectSecretPlaintext,
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
  cachedProjectSourcePath,
  projectDataDirKey,
  registerProjectWorkspaceInitEvents,
  type PreparedWorkspaceSource,
} from "./workspace-source.ts";

export { registerProjectWorkspaceEvents } from "./workspace-repos.ts";

export { getProjectSshKnownHosts, setProjectSshKnownHosts } from "./ssh-host-trust.ts";
export { sshHostTrustFailure, unknownSshHost, scanSshHost, trustScannedSshHost } from "./ssh-trust-recovery.ts";
export { onWorkspaceSshTrustChanged, workspaceSshTrustRequests, requestWorkspaceSshTrust, decideWorkspaceSshTrust, cancelWorkspaceSshTrust, type WorkspaceSshTrustRequest } from "./ssh-trust-broker.ts";
export { isSshAuthenticationFailure } from "./git-access-failure.ts";

export { projectSecretHosts, projectSecretAllowsPath } from "./secret-path-policy.ts";
