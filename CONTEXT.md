# AgentsInTheCloud

AgentsInTheCloud is a workspace interface for collaborating with coding agents while inspecting and operating on the work they produce.

## Language

**Workspace template**:
What a new workspace is seeded with: a repository to clone plus configuration such as environment variables, a Dockerfile, secrets and SSH keys. Called "template" in the app. Secrets and SSH keys stay live in workspaces created from it; everything else applies only to new workspaces.
_Avoid_: Project, workspace folder, repository

**Template icon**:
The marker that identifies a workspace's template in the Workspace pane. By default it is a **swatch**: a colored square derived from the template id.
_Avoid_: Chip, badge, avatar

**Workspace**:
An isolated environment in which a user collaborates with agents and inspects or operates on their work. A workspace may be created from a Workspace template or with nothing.
_Avoid_: Task, chat

**Empty workspace**:
A workspace seeded with nothing, and therefore without a template's repository or configuration.
_Avoid_: Projectless workspace, empty template

**Parked workspace**:
A retained Workspace set aside from active use while remaining associated with its Workspace template. Activity requiring user attention automatically unparks it.
_Avoid_: Archived workspace, inactive workspace

**Workspace pane**:
The collapsible navigation region for finding and switching between workspaces.
_Avoid_: Left sidebar, workspace tab

**Agent**:
An independently named coding collaborator within a Workspace, with its own AgentPaneComposer and Agent session. A Workspace may contain one or more Agents, with one active at a time; starting a fresh session does not create another Agent.
_Avoid_: Agent conversation, Agent view, agent tab, chat, thread

**Agent type**:
The coding-agent implementation an Agent uses: Builtin, Claude Code, Codex, or Pi. An Agent type is distinct from the Model provider supplying its models.
_Avoid_: Agent provider, agent backend

**Model provider**:
A service that supplies models, such as OpenAI or Anthropic. The Model providers available to an Agent depend on its Agent type and connected credentials.
_Avoid_: Agent provider

**Enabled model**:
A model included in the saved list used for an Agent’s composer model choices. Models may be enabled automatically when connecting a Model provider or by the user; being enabled does not guarantee availability through the Agent type, account access, or current credentials.
_Avoid_: Favorite model, configured model, your models, model shortlist

**Thinking level**:
A model-specific setting requesting how much reasoning effort an Agent’s model uses for subsequent work. Supported levels depend on the model and Agent type; a Thinking level is a configuration choice, not the reasoning text produced by the model.
_Avoid_: Reasoning effort, effort, thinking mode

**Agent pane**:
The primary region for collaborating with the active Agent in a Workspace.
_Avoid_: Left tab, chat tab

**AgentPaneComposer**:
The composer in an Agent pane for collaborating with its active Agent and selecting the model and thinking level used for subsequent Agent work.
_Avoid_: Agent composer, in-pane composer, prompt box, chat input

**LaunchComposer**:
The composer used before a Workspace exists to provide its Agent’s initial prompt and select the model and thinking level with which the Workspace starts.
_Avoid_: Launch form, launch prompt, new-workspace composer

**Agent session**:
An Agent's replaceable interaction history. Starting a fresh Agent session resets the active context while keeping the same Agent, its settings, and its searchable history.
_Avoid_: Agent, Agent conversation

**Work pane**:
The contextual region that slides in when needed to show files, terminals, browsers, editors, and other working views.
_Avoid_: Right tab, preview tab

**Work view**:
A closable, reorderable destination inside the Work pane, such as a Terminal, Browser, File, or Files view. Only one Work view is active and visible at a time; Work views are not split into additional layout groups.
_Avoid_: Workspace group, preview group

**Resource Work view**:
A Work view representing an independently open resource or running session, such as a File, Browser, Terminal, or VS Code view.
_Avoid_: Document view, permanent view

**Contextual Work view**:
A workspace-level utility Work view, such as Files.
_Avoid_: Permanent view, special view

**Mobile destination**:
A top-level phone navigation target for the Workspace pane, an Agent, or a Work view configured for direct mobile access. Every Agent is directly reachable. Open File, Browser, and Terminal views are directly reachable; Files and VS Code views are found through More.
_Avoid_: Mobile tab, mobile Work pane

**AgentsInTheCloud bar**:
The phone-only bottom navigation bar for controls whose scope is AgentsInTheCloud rather than the selected Workspace. It is visible while the Workspace pane is visible, occupies the full bottom edge, and replaces the Workspace bar. When hidden, only the Workspace pane button remains visible at the bottom-left.
_Avoid_: Application bar, global bar, Workspace pane bar

**Workspace pane button**:
The phone control that remains at the bottom-left while the AgentsInTheCloud bar is hidden. Activating it opens the Workspace pane and reveals the AgentsInTheCloud bar.
_Avoid_: AgentsInTheCloud button, open button

**Workspace bar**:
The phone-only bottom navigation bar containing Mobile destinations within the selected Workspace, such as Agents, Browser, Review, and More. It is visible while the Workspace pane is hidden and is replaced by the AgentsInTheCloud bar when the Workspace pane opens.
_Avoid_: Current Workspace toolbar, resident bar

**Next attention**:
An AgentsInTheCloud navigation action that opens the Workspace that has been requesting attention longest, regardless of whether it is busy or preloaded.
_Avoid_: Next unread, next Agent

**More**:
The user-facing phone destination that opens a bottom sheet with separate sections for Work views not configured for direct mobile access and launchers that create or reveal Work views. Singleton utility launchers such as Files remain available when their live Work views are closed. Selecting a Work view from More leaves the stable bottom destination bar unchanged, and More remains highlighted while a secondary Work view is visible. “Work” remains domain language and is not exposed as the name of this mobile affordance.
_Avoid_: Work, overflow

**Work view reference**:
A stable, type-bearing identity for one Work view. Generic Work pane actions accept any Work view reference, while type-specific actions accept only references of their own kind.
_Avoid_: Tab key, untyped view ID

**Unavailable Work view**:
A persistent Work view whose referenced resource cannot currently be loaded. It remains visible as an explicit unavailable state until its resource returns or the user closes it.
_Avoid_: Broken tab, missing tab

**Terminal view**:
A Work view connected to a terminal session. It either owns a session created specifically for it or attaches to an independently existing session.
_Avoid_: Terminal tab

**Owned terminal session**:
A terminal session created specifically for one Terminal view and governed by that view's lifecycle.
_Avoid_: Attached session

**Attached terminal session**:
A pre-existing terminal session surfaced through a Terminal view while retaining a lifecycle independent of that view.
_Avoid_: Owned session

**Workspace phase**:
The single active part of a Workspace's lifecycle: Provisioning phase, Running phase, or Deleting phase. A failure or a pending decision is a state within its phase, not another phase.

**Provisioning phase**:
The phase that prepares a Workspace for use. It is busy while progressing, not busy while waiting for a user decision or after failure. A decision or failure requests attention for the Workspace.

**Running phase**:
The phase in which a Workspace's Agents and Work views are available. It is busy if any Agent is busy. When an Agent or Work view starts requesting attention, this phase requests attention for the Workspace.

**Deleting phase**:
The phase that reviews and removes a Workspace. It is busy while progressing, not busy while waiting for a user decision or after failure. A decision or failure requests attention for the Workspace.

**Busy**:
An independent yes/no state of an Agent or Workspace phase. A Workspace is busy exactly when its active phase is busy. Work views do not contribute busy state.

**Requesting attention**:
An independent yes/no state of a Workspace, Agent, or Work view. It remains set until that particular destination becomes visible. A visible destination never starts requesting attention. Repeated requests do not change its place in the oldest-first order.
_Avoid_: Unread, Agent ready

**Attention request**:
An event asking the user to inspect a destination. A phase's request sets its Workspace's requesting-attention state only while that Workspace is not visible. Workspace visibility clears only Workspace attention, not the attention of hidden Agents or Work views. Attention does not itself change the visible destination.

**Workspace selection**:
Opening a Workspace makes its oldest requesting-attention Agent visible and, on desktop, its oldest requesting-attention Work view visible. An Agent presentation also makes its presented Work view visible on desktop; on mobile it only requests attention.

**Preload state**:
A browser-local state indicating whether a Workspace is preloaded, preloading, or neither. It does not affect busy or requesting-attention state. Workspace attention indicators are dimmed until preloading finishes.

**File view**:
A Work pane view for reading and, when writable, editing one Workspace file. A file has at most one open File view within a Workspace.
_Avoid_: File tab, editor tab

**Persistent Work view state**:
The server-restorable identity, order, and type-specific resource state of an open Work view. Its durability follows the view type rather than whether the user or agent created it, and remains until the view is explicitly closed.
_Avoid_: Published workspace state, saved layout

**Personal navigation state**:
A browser-local record of the user's choices while navigating persistent Work views, such as the selected destination, pane and drawer visibility, Work-pane width, and scroll position. It may be restored by that browser but is not server-authoritative workspace state.
_Avoid_: Workspace state
