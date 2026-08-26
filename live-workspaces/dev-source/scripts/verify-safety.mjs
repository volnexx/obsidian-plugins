import { readFile, readdir } from "node:fs/promises";

const files = [
  "src/workspace/WorkspaceSwitcher.ts",
  "src/layout/PaneVisibility.ts",
  "src/sidebar/SidebarManager.ts"
];
const forbidden = [".detach(", ".setViewState(", ".changeLayout("];

for (const path of files) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const token of forbidden) {
    if (source.includes(token)) throw new Error(`${path} contains forbidden live-switch operation ${token}`);
  }
}

const restore = await readFile(new URL("../src/layout/LayoutRestore.ts", import.meta.url), "utf8");
if (!restore.includes("setViewState")) throw new Error("Restart restore must remain isolated in LayoutRestore");

async function sourceFiles(url) {
  const entries = await readdir(url, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    return entry.isDirectory() ? sourceFiles(child) : entry.name.endsWith(".ts") ? [child] : [];
  }));
  return nested.flat();
}

const allSources = await sourceFiles(new URL("../src/", import.meta.url));
const occurrences = { detach: [], setViewState: [], changeLayout: [] };
for (const url of allSources) {
  const source = await readFile(url, "utf8");
  for (const [name, token] of [["detach", ".detach("], ["setViewState", ".setViewState("], ["changeLayout", ".changeLayout("]]) {
    if (source.includes(token)) occurrences[name].push(url.pathname);
  }
}
if (occurrences.changeLayout.length !== 0) throw new Error("changeLayout must not exist anywhere in the plugin");
if (occurrences.setViewState.length !== 1 || !occurrences.setViewState[0].endsWith("/layout/LayoutRestore.ts")) {
  throw new Error("setViewState must exist only in restart-only LayoutRestore");
}
if (occurrences.detach.length !== 1 || !occurrences.detach[0].endsWith("/workspace/WorkspaceManager.ts")) {
  throw new Error("detach must exist only in explicit workspace deletion");
}

console.log("Safety verification passed: live-switch path contains no detach, setViewState, or changeLayout.");
