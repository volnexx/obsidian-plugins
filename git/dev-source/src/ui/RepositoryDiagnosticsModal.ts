import { Modal, type App } from "obsidian";

import type { RepositoryController } from "../application/public/RepositoryController";

export class RepositoryDiagnosticsModal extends Modal {
  constructor(app: App, private readonly repositories: RepositoryController) { super(app); }

  override onOpen(): void {
    this.setTitle("Git repositories");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Refreshing read-only repository status…" });
    void this.repositories.refreshAll().finally(() => this.#render());
  }

  #render(): void {
    this.contentEl.empty();
    const repositories = this.repositories.list();
    if (repositories.length === 0) { this.contentEl.createEl("p", { text: "No Git repositories found in the plugin directory." }); return; }
    for (const repository of repositories) {
      const section = this.contentEl.createDiv({ cls: "git-repository-diagnostic" });
      section.createEl("h3", { text: repository.displayPath });
      section.createEl("code", { text: repository.rootPath });
      section.createEl("p", { text: `${repository.branch}${repository.upstream === null ? "" : ` → ${repository.upstream}`} · staged ${repository.staged} · unstaged ${repository.unstaged} · untracked ${repository.untracked} · conflicts ${repository.conflicts} · ↑${repository.ahead} ↓${repository.behind}` });
      if (repository.error !== null) section.createEl("p", { text: `Error: ${repository.error}`, cls: "mod-warning" });
    }
  }
}
