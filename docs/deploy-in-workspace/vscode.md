# VS Code in AgentsInTheCloud workspaces

AgentsInTheCloud includes browser-based VS Code in each workspace. The default workspace image already contains the VS Code server and AgentsInTheCloud's default VS Code extensions.

## Add extensions permanently for a repository

To make a repository always start with additional VS Code extensions, add `.agents-in-the-cloud/Dockerfile` to that repository. The file must start with AgentsInTheCloud's workspace base image:

```Dockerfile
FROM agents-in-the-cloud-workspace
```

Install extensions during the image build with the bundled VS Code server CLI and AgentsInTheCloud's shared extensions directory:

```Dockerfile
FROM agents-in-the-cloud-workspace
# AgentsInTheCloud image version: 1

RUN su agents-in-the-cloud -c '/opt/agents-in-the-cloud/vscode-server/bin/code-server \
  --server-data-dir /.agents-in-the-cloud/vscode/server-data \
  --extensions-dir /opt/agents-in-the-cloud/vscode-extensions \
  --install-extension rust-lang.rust-analyzer \
  --force'
```

You can install multiple extensions in one Dockerfile:

```Dockerfile
FROM agents-in-the-cloud-workspace
# AgentsInTheCloud image version: 1

RUN su agents-in-the-cloud -c '/opt/agents-in-the-cloud/vscode-server/bin/code-server \
  --server-data-dir /.agents-in-the-cloud/vscode/server-data \
  --extensions-dir /opt/agents-in-the-cloud/vscode-extensions \
  --install-extension rust-lang.rust-analyzer \
  --force' \
 && su agents-in-the-cloud -c '/opt/agents-in-the-cloud/vscode-server/bin/code-server \
  --server-data-dir /.agents-in-the-cloud/vscode/server-data \
  --extensions-dir /opt/agents-in-the-cloud/vscode-extensions \
  --install-extension dbaeumer.vscode-eslint \
  --force'
```

AgentsInTheCloud starts VS Code with `/opt/agents-in-the-cloud/vscode-extensions`, so extensions installed there are available every time a workspace is created from that repository.

## Notes

- Repository Dockerfiles are built once per default workspace image plus `.agents-in-the-cloud/Dockerfile` contents and then reused; regular source changes do not rebuild them.
- Installing extensions in `.agents-in-the-cloud/Dockerfile` makes first workspace creation for that repository slower, but later workspaces reuse the built image.
- The default AgentsInTheCloud extensions are already in `/opt/agents-in-the-cloud/vscode-extensions`; do not replace that directory unless you intentionally want to remove them.
