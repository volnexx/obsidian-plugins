import { Notice, type Plugin } from "obsidian";
import type { WorkspaceManager } from "../workspace/WorkspaceManager";
import { DeleteWorkspaceModal, WorkspaceNameModal, WorkspaceQuickSwitcher } from "../ui/WorkspaceModals";

export function registerWorkspaceCommands(plugin: Plugin, manager: WorkspaceManager): void {
  const run = (operation: Promise<void>): void => {
    void operation.catch((error) => console.error("[Live Workspaces] Command failed", error));
  };

  plugin.addCommand({
    id: "create-workspace",
    name: "Workspace: Create",
    callback: () =>
      new WorkspaceNameModal(plugin.app, "Create live workspace", manager.suggestWorkspaceName(), (name) => {
        run(manager.createWorkspace(name));
      }).open()
  });

  plugin.addCommand({
    id: "rename-workspace",
    name: "Workspace: Rename active",
    callback: () => {
      const active = manager.getActiveWorkspace();
      new WorkspaceNameModal(plugin.app, "Rename live workspace", active.name, (name) => manager.renameWorkspace(active.id, name)).open();
    }
  });

  plugin.addCommand({
    id: "delete-workspace",
    name: "Workspace: Delete active",
    checkCallback: (checking) => {
      if (manager.getWorkspaces().length <= 1) return false;
      if (!checking) {
        const active = manager.getActiveWorkspace();
        new DeleteWorkspaceModal(plugin.app, active, () => void manager.deleteWorkspace(active.id)).open();
      }
      return true;
    }
  });

  plugin.addCommand({ id: "next-workspace", name: "Workspace: Next", callback: () => run(manager.switchNext()) });
  plugin.addCommand({ id: "previous-workspace", name: "Workspace: Previous", callback: () => run(manager.switchPrevious()) });
  plugin.addCommand({
    id: "quick-switcher",
    name: "Workspace: Quick switcher",
    callback: () => new WorkspaceQuickSwitcher(plugin.app, () => manager.getWorkspaces(), (item) => run(manager.switchTo(item.id))).open()
  });

  for (let slot = 1; slot <= 9; slot += 1) {
    plugin.addCommand({
      id: `switch-to-slot-${slot}`,
      name: `Workspace: Switch to slot ${slot}`,
      checkCallback: (checking) => {
        const workspace = manager.getWorkspaceBySlot(slot);
        if (!workspace) return false;
        if (!checking) run(manager.switchTo(workspace.id));
        return true;
      }
    });
  }

  plugin.addCommand({
    id: "run-lifecycle-probe",
    name: "Workspace: Run lifecycle feasibility probe",
    checkCallback: (checking) => {
      if (manager.getWorkspaces().length < 2) return false;
      if (!checking) {
        void manager.runLifecycleProbe().then((result) => {
          console.info("[Live Workspaces] Lifecycle probe", result);
          new Notice(result.passed ? "Live Workspaces probe passed. See developer console for details." : "Live Workspaces probe failed; fail-safe enabled. See developer console.", 8000);
        });
      }
      return true;
    }
  });

  plugin.addCommand({
    id: "fail-safe-show-all",
    name: "Workspace: Fail-safe — show all panes",
    callback: () => manager.showAllPanes()
  });
}
