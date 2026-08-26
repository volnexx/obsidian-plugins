import { Notice, Platform, Plugin } from "obsidian";
import { registerWorkspaceCommands } from "./commands/registerWorkspaceCommands";
import { WorkspaceManager } from "./workspace/WorkspaceManager";
import { WorkspacePersistence } from "./workspace/WorkspacePersistence";

export default class LiveWorkspacesPlugin extends Plugin {
  private manager: WorkspaceManager | null = null;
  private persistence: WorkspacePersistence | null = null;

  async onload(): Promise<void> {
    if (Platform.isMobileApp) {
      new Notice("Live Workspaces currently supports desktop Obsidian only.");
      return;
    }

    this.persistence = new WorkspacePersistence(this);
    const data = (await this.persistence.load()) ?? WorkspaceManager.initialData();
    this.manager = new WorkspaceManager(this, this.persistence, data);
    registerWorkspaceCommands(this, this.manager);
    this.manager.attachStatusElement(this.addStatusBarItem());
    this.app.workspace.onLayoutReady(() => this.manager?.initialize());
    this.warnAboutWorkspaceManagers();
  }

  onunload(): void {
    if (this.manager) void this.manager.dispose();
  }

  private warnAboutWorkspaceManagers(): void {
    const app = this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } };
    const enabled = app.plugins?.enabledPlugins;
    if (!enabled) return;
    const conflicts = ["working-tabs", "workspace-plus-plus"].filter((id) => enabled.has(id));
    if (conflicts.length > 0) {
      new Notice(
        `Live Workspaces: avoid switching layouts with ${conflicts.join(", ")} while live panes are active.`,
        10000
      );
    }
  }
}
