/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "ui-must-not-import-git-infrastructure",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/git/infrastructure/" }
    },
    {
      name: "ui-may-import-only-application-public-or-ui",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/(?!application/public/|ui/)" }
    },
    {
      name: "application-must-not-import-git-infrastructure",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/git/infrastructure/" }
    },
    {
      name: "application-must-not-import-execution-capabilities",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/authorization/" }
    },
    {
      name: "application-public-must-not-import-internals",
      severity: "error",
      from: { path: "^src/application/public/" },
      to: { path: "^src/(application/internal|authorization|core|git|operations|safety|state|watching)/" }
    },
    {
      name: "process-execution-only-in-git-infrastructure",
      severity: "error",
      from: { path: "^src/(?!git/infrastructure/)" },
      to: { path: "^(node:)?child_process$|^simple-git$" }
    },
    {
      name: "domain-must-not-depend-on-other-layers",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/(?!domain/)" }
    },
    {
      name: "authorization-must-depend-only-on-domain",
      severity: "error",
      from: { path: "^src/authorization/" },
      to: { path: "^src/(?!authorization/|domain/)" }
    },
    {
      name: "lower-layers-must-not-depend-on-application-or-ui",
      severity: "error",
      from: { path: "^src/(authorization|core|state|operations|safety|watching|git)/" },
      to: { path: "^src/(ui|application)/" }
    },
    {
      name: "application-must-not-depend-on-ui",
      severity: "error",
      from: { path: "^src/application/" },
      to: { path: "^src/ui/" }
    },
    {
      name: "safety-internals-only-for-safety",
      severity: "error",
      from: { path: "^src/(?!safety/)" },
      to: { path: "^src/safety/internal/" }
    },
    {
      name: "git-port-must-not-depend-on-state",
      severity: "error",
      from: { path: "^src/git/" },
      to: { path: "^src/state/" }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "types", "default"] },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } }
  }
};
