import type { RepositoryContext } from "../../../../src/core/RepositoryContext";

declare const context: RepositoryContext;

// This fixture must be rejected by the UI import-boundary analyzer.
void context.backend;
