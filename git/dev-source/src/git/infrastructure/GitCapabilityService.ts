import type { DesktopGitCommandRunner } from "./GitCommandRunner";

let processWideCapability: Promise<string> | null = null;

export class GitCapabilityService {
  constructor(private readonly runner: DesktopGitCommandRunner) {}

  check(signal?: AbortSignal): Promise<string> {
    processWideCapability ??= this.runner.checkCapability(signal).catch((error: unknown) => {
      processWideCapability = null;
      throw error;
    });
    return processWideCapability;
  }
}
