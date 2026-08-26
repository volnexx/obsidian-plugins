import { Plugin } from "obsidian";
import { PluginRuntime } from "./composition/PluginRuntime";

/**
 * Composition root. All Git runtime construction remains in composition/PluginRuntime.
 */
export default class GitPlugin extends Plugin {
  #runtime: PluginRuntime | null = null;

  override async onload(): Promise<void> {
    this.#runtime = await PluginRuntime.create(this);
    this.addCommand({ id: "show-repositories", name: "Git: Show repositories", callback: () => this.#runtime?.showRepositories() });
  }

  override onunload(): void {
    const runtime = this.#runtime;
    this.#runtime = null;
    if (runtime !== null) void runtime.dispose();
  }
}
