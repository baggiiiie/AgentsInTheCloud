# Automating AgentsInTheCloud

AgentsInTheCloud's web UI operations also provide compact JSON representations for agents and scripts. They are the same operations used by the Turbo UI, not a separate REST implementation.

## Discovery

The authoritative contract for the running instance is:

```http
GET /openapi.json
```

Discover available Agent types with `GET /agent-types`; the response contains `agentTypes` and `defaultAgentTypeId`. Agent summaries identify their implementation with `agentTypeId`.

Inspect it without loading the whole document into context:

```sh
curl -s http://localhost:3000/openapi.json | jq -r '.paths | keys[]'
curl -s http://localhost:3000/openapi.json | jq '.paths["/workspaces/{id}/commands/{commandId}"]'
```

Send these headers for JSON operations:

```http
Accept: application/json
Content-Type: application/json
```

Errors use `{ "error": { "code": "...", "message": "..." } }`.

## Present a workspace

Workspace, Agent, and Work-view destinations are browser-navigable surfaces:

```text
/workspaces/:workspaceId
/workspaces/:workspaceId?agent=:agentId
/workspaces/:workspaceId?workView=:key
```

The `agent` and `workView` parameters may be combined to choose both sides of the desktop workspace. Use `GET /workspaces/:workspaceId` with `Accept: application/json` to discover the available Agent IDs and the `key` of each Work view.

## Present workspace template settings

Workspace template settings has a browser-navigable surface that agents can pass directly to their presentation tool:

```text
/workspace-templates/:workspaceTemplateId/settings
/workspace-templates/:workspaceTemplateId/settings?section=environment
```

Supported sections are `index`, `general`, `secrets`, `ssh`, `environment`, and `container`. The index lists the five settings sections; each section opens a focused page in the complete AgentsInTheCloud shell. Use `editor=new` or a record ID for Secrets, SSH keys, or Environment, and `editor=docker`, `images`, or `dockerfile` for Container. Legacy section links (`repository`, `ssh-keys`, `privileged`, `dockerfile`, `preload-images`, and `danger`) still resolve to their corresponding pages.

Use `GET /workspace-templates` with `Accept: application/json` to discover the template ID before constructing the presentation URL.

Other browser-navigable surfaces are:

```text
/workspaces/new                                           # Launch composer for an empty workspace
/workspace-templates/:workspaceTemplateId/workspaces/new  # Launch composer for a workspace from a template
/workspace-templates/new                                  # Add a template
/models                                 # Models: Model providers, their usage, and enabled models
/settings                               # AgentsInTheCloud settings
/settings?section=models                # A specific settings section
/settings/development                   # Development settings
/design-system-catalogue.html           # Live component catalogue (HTML)
```

The settings section is a registered settings contribution ID, such as `theme`, `git-identity`, `github`, `models`, `transcription`, or `update`.

## Create and wait for a workspace

Creation is asynchronous and returns `202 Accepted` immediately. The response’s
`workspace.url` and `Location` header are origin-relative paths, like workspace
detail URLs. Resolve them against the public request URL to preserve HTTPS
when AgentsInTheCloud runs behind a TLS-terminating proxy:

```sh
created=$(curl -sS -X POST http://localhost:3000/workspaces \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"source":{"type":"empty"},"title":"Evaluation"}')
id=$(jq -r '.workspace.id' <<<"$created")
```

`source` may be `{ "type": "empty" }` or `{ "type": "workspace-template", "workspaceTemplate": "name-or-id" }`. Optional `agent` fields are `agentTypeId` (Builtin, Claude Code, Codex, or Pi: `builtin`, `claude`, `codex`, or `pi`), `initialPrompt`, `model`, `thinkingLevel`, and `attachmentDraft`.

Poll the same UI URL with JSON content negotiation:

```sh
while :; do
  workspace=$(curl -sS -H 'Accept: application/json' "http://localhost:3000/workspaces/$id")
  phase=$(jq -r '.workspace.phase.kind' <<<"$workspace")
  [ "$phase" = runningPhase ] && break
  [ "$(jq -r '.workspace.phase.status' <<<"$workspace")" = failed ] && { jq . <<<"$workspace"; exit 1; }
  sleep .2
done
```

Existing workspaces are discovered before the server starts listening. Each active
workspace then runs its startup checklist in the background with phase `provisioningPhase`.
Readiness checks the ingress and egress gateways, parent sockets, and the workspace's
saved image preload list. Failure retains the container for repair and presents
**Retry** and **Continue anyway**. Use
`POST /workspaces/:id/provisioning/continue?action=retry` to retry runtime preparation,
or omit the query parameter to explicitly bypass the failure. Bypassing makes the
workspace enter `runningPhase` while retaining its preparation warning. Until startup completes,
the workspace shows its checklist instead of its Agents or Work views. AgentsInTheCloud and
other workspaces remain available throughout.

The list and detail responses include optional `issues` entries with `kind` and
`message`. Image inspection runs independently at AgentsInTheCloud startup. Readiness checks
run again when a workspace resumes or AgentsInTheCloud restarts; bypassing a failure does not
permanently disable checks. Existing workspaces keep their saved preload references
when template settings change.

A running-phase response advertises its `agents`, typed `workViews`, and available `commands` with their `inputSchema`.

## Stage Agents and Work views

Execute commands using their advertised schema:

```sh
curl -sS -X POST "http://localhost:3000/workspaces/$id/commands/terminal.create" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"title":"Tests","cwd":"/work","command":"bun test"}'

curl -sS -X POST "http://localhost:3000/workspaces/$id/commands/browser.create" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:3000/"}'

curl -sS -X POST "http://localhost:3000/workspaces/$id/commands/agent.create" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{}'
```

Navigate an existing Browser Work view with `POST /workspaces/:id/browser/:browserId/navigate` and `{ "url": "..." }`.

## Arrange Work views

- `POST /workspaces/:id/work-views/reorder` with `key` and `index`
- `POST /workspaces/:id/work-views/close` with a typed `reference`
- `POST /workspaces/:id/work-views/:key/attention/request` to request attention for a Work view without selecting it

Open Work-view identity and order are server-persistent. Workspace, agent, and view `requestingAttention` states are independent and server-persistent; each clears only when that destination becomes visible. Workspace `phase` is an object with `kind` and `busy`, plus phase-specific substates. Agent summaries include `busy` and `requestingAttention`. Active destinations, pane visibility, and Work-pane width are browser-local.

The Agent `/park` message responds with a `307` redirect to the workspace park operation.
Follow redirects while preserving the POST method and Accept header (for example, `curl -L`).
Confirmation is returned only to that requester; JSON clients receive `409` when confirmation is needed.

Rename with `POST /workspaces/:id/sidebar-title` and `{ "title": "..." }`. Park, unpark, and delete use the corresponding existing workspace UI routes with `Accept: application/json`.

## Control an agent

- `POST /workspaces/:id/agents/:agentId/model` with `{ "model": "provider::model" }`
- `POST /workspaces/:id/agents/:agentId/thinking-level` with `{ "thinkingLevel": "medium" }`
- `POST /workspaces/:id/agents/:agentId/messages` with `{ "text": "...", "mode": "send" }`
- `POST /workspaces/:id/agents/:agentId/abort`

Message submission returns `202 Accepted`; it does not wait for inference to finish.

## Present the result

After staging the desired Work view, use the agent's `present` tool with:

```text
http://localhost:3000/workspaces/<id>
```

## Inspect Model provider usage

`GET /usage` with `Accept: application/json` returns all connected providers with
implemented subscription-usage support (OpenAI Codex and Anthropic). Refresh an
individual provider with `GET /usage/providers/openai-codex` or
`GET /usage/providers/anthropic` and the same header. Anthropic requires subscription
OAuth sign-in, not an API key. Its five-hour, weekly, and available model/feature
windows use the same pacing reference. Buckets with no reset timestamp retain
their reported usage, with null reset and timing values and timing state `unknown`.
Null buckets are omitted; monetary extra usage is not a paced allowance. Anthropic
does not report a plan name or account-wide allowed/limit-reached flags, so these
are null.
In the app, each provider’s usage shows on its card in the Models dialog; the
workspace Usage button opens that dialog with its provider expanded.

Each result includes provider-reported windows, their durations and resets,
and pacing relative to elapsed time. Provider failures populate `error`.
The Usage feature does not record or persist installation-wide token totals.

A provider card groups provider-reported 0% windows under **Unused limits**
(collapsed when there are used limits, expanded when all limits are unused)
and renders reset countdowns such as `3d 12h`. The workspace Usage button traces
Time and Usage for the subscription whose active allowance is furthest ahead of pace
among subscriptions used for successful inference in the 30 minutes ending at the
last recorded inference. Limits are checked at display time, not frozen at the time
of that inference. Built-in Agent inference and connected-subscription CLI traffic
through workspace egress contribute activity; API-key traffic does not. Activity is
kept in memory and cleared on credential changes. The button refreshes every minute
while visible, on focus, and whenever a provider card loads fresh limits. No recorded activity or no
available active limits means no comparison ring. Both arcs start at twelve
o’clock and run clockwise on the same circle. Their shared portion is neutral;
Time beyond Usage is green, and Usage beyond Time is red. A dim full-circle
track preserves the button outline beneath the arcs.
Among active windows with nonzero usage, the button selects the greatest
Usage-minus-Time difference; ties prefer higher Usage. When all active windows are
unused, the main allowance takes precedence over feature-specific allowances.
Expired/not-started windows and windows with unknown reset timing are excluded.
`GET /usage/button` returns the server-rendered button frame
(or a Turbo Stream with `Accept: text/vnd.turbo-stream.html`).
Each window also includes `timing`: the inferred start (`reset − duration`),
elapsed-time percentage, and usage-minus-time difference in percentage points.
`paceDifferenceSeconds` converts that difference to distance along the allowance
schedule (`paceDifferencePoints / 100 × durationSeconds`). Provider cards and the button
label show compact durations such as `30m ahead of pace` or `1d 4h behind pace`.
Positive means consumption is ahead; negative means behind. This is not time
until exhaustion. Both difference fields are null outside an active window.
Each provider card shows Time and Usage percentages above one comparison bar per allowance.
Both grow from the left: overlap is neutral, Time beyond Usage is green, and Usage
beyond Time is red. Outside an active window the bar stays neutral. This is a linear pacing
reference, not a billing forecast; pacing is omitted before a window starts or
once its reset is due.

Usage is contributed by the Agent module, including these OpenAPI paths. Its
header action and directly navigable dialog use the generic
[module-owned workspace-pane action interface](workspace-pane-actions.md).
