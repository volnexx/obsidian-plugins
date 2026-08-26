import assert from "node:assert/strict";
import { build } from "esbuild";

const output = await build({
  entryPoints: ["src/workspace/WorkspaceSwitcher.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`;
const { WorkspaceSwitcher } = await import(moduleUrl);

function createHost() {
  let active = "a";
  const calls = [];
  return {
    calls,
    get active() { return active; },
    getActiveWorkspaceId: () => active,
    hasWorkspace: (id) => ["a", "b", "c"].includes(id),
    ensureRuntime: async (id) => calls.push(`ensure:${id}`),
    reconcileNow: async () => calls.push("reconcile"),
    captureWorkspace: (id) => calls.push(`capture:${id}`),
    getOwnedGroupDiagnostics: (id) => [{ id: `group:${id}`, area: "main", leafIds: [`leaf:${id}`] }],
    projectWorkspace: async (id) => { calls.push(`project:${id}`); return { hiddenPanes: 1, shownPanes: 1 }; },
    restoreSidebar: (id) => calls.push(`sidebar:${id}`),
    resolveFocusLeaf: () => null,
    activateLeaf: () => calls.push("focus"),
    commitActiveWorkspace: (id) => { active = id; calls.push(`commit:${id}`); },
    failSafe: (error) => { throw error; }
  };
}

{
  const host = createHost();
  const switcher = new WorkspaceSwitcher(host);
  await switcher.switchTo("b");
  assert.equal(host.active, "b");
  assert.deepEqual(host.calls, ["ensure:b", "reconcile", "capture:a", "project:b", "sidebar:b", "commit:b"]);
  host.calls.length = 0;
  await switcher.switchTo("a");
  assert.equal(host.active, "a");
  assert.deepEqual(host.calls, ["ensure:a", "reconcile", "capture:b", "project:a", "sidebar:a", "commit:a"]);
}

{
  const host = createHost();
  let releaseEnsure;
  host.ensureRuntime = (id) => {
    host.calls.push(`ensure:${id}`);
    if (id !== "b") return Promise.resolve();
    return new Promise((resolve) => (releaseEnsure = resolve));
  };
  const switcher = new WorkspaceSwitcher(host);
  const first = switcher.switchTo("b");
  await Promise.resolve();
  const latest = switcher.switchTo("c");
  releaseEnsure();
  await Promise.all([first, latest]);
  assert.equal(host.active, "c");
  assert.equal(host.calls.includes("project:b"), false, "stale pre-commit projection should be skipped");
  assert.equal(host.calls.includes("project:c"), true);
}

console.log("WorkspaceSwitcher tests passed: round trip, serialized switch, and last-request-wins behavior verified.");
