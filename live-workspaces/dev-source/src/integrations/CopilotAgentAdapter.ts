/**
 * Optional future integration point. Live Workspaces does not import Copilot
 * internals; a patched Copilot can implement this contract and bind one Agent
 * session to each persisted workspace ID.
 */
export interface CopilotAgentAdapter {
  isAvailable(): boolean;
  ensureSession(workspaceId: string, persistedSessionId?: string): Promise<string>;
  activateSession(workspaceId: string, sessionId: string): Promise<void> | void;
  releaseWorkspace(workspaceId: string, sessionId: string): Promise<void> | void;
}
