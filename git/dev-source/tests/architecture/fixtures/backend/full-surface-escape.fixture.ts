interface InheritedEscape { inheritedRaw(): void; }
export interface BackendSurfaceEscape extends InheritedEscape {
  readonly repositoryId: string;
  readonly rawExecutor: () => void;
  (): void;
  readonly [name: string]: unknown;
}
