# Live Workspaces

Desktop-only experimental Obsidian plugin for multiple simultaneously live workspaces.

## Runtime invariant

Normal workspace switching changes only CSS visibility classes and focus. It does not call `detach()`, `setViewState()`, or `changeLayout()`. Leaves and their ItemView instances remain in Obsidian's native workspace tree.

`setViewState()` is isolated in `LayoutRestore` and may run only when reconstructing a missing workspace after an Obsidian restart. Explicit workspace deletion closes that workspace's leaves.

Each workspace record already has an optional `copilotAgentSessionId`. The optional `CopilotAgentAdapter` contract is the future integration boundary; this plugin does not reach into Copilot's private singleton state.

## Feasibility probe

Create at least two workspaces, then run **Workspace: Run lifecycle feasibility probe** from the command palette. The probe switches to the next workspace and back while checking:

- WorkspaceLeaf identity;
- loaded ItemView identity;
- WorkspaceTabs DOM identity;
- round-trip pane dimensions;
- active workspace restoration;
- calls to `View.onClose` during the switch.

The complete result is written to the developer console. A failed probe activates the fail-safe and shows every pane.

## Development

```bash
npm install
npm run verify
```
