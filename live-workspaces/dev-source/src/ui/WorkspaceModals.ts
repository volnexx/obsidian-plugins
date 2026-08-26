import { FuzzySuggestModal, Modal, Setting, type App } from "obsidian";
import type { LiveWorkspaceRecord } from "../types/workspace";

export class WorkspaceNameModal extends Modal {
  private value: string;

  constructor(
    app: App,
    title: string,
    initialValue: string,
    private readonly submit: (value: string) => void
  ) {
    super(app);
    this.setTitle(title);
    this.value = initialValue;
  }

  onOpen(): void {
    this.contentEl.empty();
    new Setting(this.contentEl)
      .setName("Name")
      .addText((text) => {
        text.setValue(this.value);
        text.inputEl.addEventListener("input", () => (this.value = text.getValue()));
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") this.finish();
        });
        window.setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        });
      });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Save").onClick(() => this.finish()));
  }

  private finish(): void {
    const value = this.value.trim();
    if (!value) return;
    this.submit(value);
    this.close();
  }
}

export class DeleteWorkspaceModal extends Modal {
  constructor(
    app: App,
    private readonly workspace: LiveWorkspaceRecord,
    private readonly confirmDelete: () => void
  ) {
    super(app);
    this.setTitle("Delete live workspace");
  }

  onOpen(): void {
    this.contentEl.empty();
    const paragraph = document.createElement("p");
    paragraph.textContent = `Delete “${this.workspace.name}”? Its live panes will be closed. This cannot be undone.`;
    this.contentEl.appendChild(paragraph);
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setWarning()
          .setButtonText("Delete")
          .onClick(() => {
            this.confirmDelete();
            this.close();
          })
      );
  }
}

export class WorkspaceQuickSwitcher extends FuzzySuggestModal<LiveWorkspaceRecord> {
  constructor(
    app: App,
    private readonly items: () => LiveWorkspaceRecord[],
    private readonly choose: (workspace: LiveWorkspaceRecord) => void
  ) {
    super(app);
    this.setPlaceholder("Switch live workspace…");
  }

  getItems(): LiveWorkspaceRecord[] {
    return this.items().slice().sort((a, b) => a.order - b.order);
  }

  getItemText(item: LiveWorkspaceRecord): string {
    return item.hotkeySlot ? `${item.name}  ·  Slot ${item.hotkeySlot}` : item.name;
  }

  onChooseItem(item: LiveWorkspaceRecord): void {
    this.choose(item);
  }
}
