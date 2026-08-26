# Runtime acceptance checklist

## Feasibility spike

1. Start desktop Obsidian and confirm **Live Workspaces** is enabled.
2. Run **Workspace: Create**, name the result `Workspace B`, then return to `Workspace 1`.
3. Put distinct notes/views in the main, left, and right groups of both workspaces.
4. Run **Workspace: Run lifecycle feasibility probe**.
5. Open Developer Tools and inspect the `[Live Workspaces] Lifecycle probe` object.

The spike passes only when `passed`, `leafIdentityPreserved`, `viewIdentityPreserved`, `groupIdentityPreserved`, `focusRestored`, and `sizesRestored` are all `true`, and `onCloseCalls` is empty.

## Long-running views

In workspace A start a terminal command, open a Web Viewer page with observable state, and start a Copilot Agent run. Switch to B, wait, then return to A.

Verify:

- the terminal process and output continued;
- Web Viewer did not reload and retained page state;
- Copilot Agent execution was not cancelled by the workspace switch;
- the same WorkspaceLeaf and loaded ItemView objects are reported by the lifecycle probe.

If any invariant fails, run **Workspace: Fail-safe — show all panes** and retain the developer console output.
