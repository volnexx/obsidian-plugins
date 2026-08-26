import { randomUUID } from "node:crypto";

import type { RepositoryId } from "../../domain/RepositoryId";
import type { RepositoryLocator } from "../../domain/RepositoryLocator";
import type { RepositoryIdentityStore } from "../../core/RepositoryDiscovery";

export interface PersistedRepositoryIdentityData { readonly identities: Readonly<Record<string, string>>; }
const locatorKey = (locator: RepositoryLocator): string => locator.kind === "vault-relative"
  ? `vault:${locator.relativePath}`
  : locator.kind === "external" ? `external:${locator.locatorId}` : `submodule:${locator.superprojectId}:${locator.relativePath}`;

export class PersistentRepositoryIdentityStore implements RepositoryIdentityStore {
  readonly #identities = new Map<string, RepositoryId>();

  constructor(data: PersistedRepositoryIdentityData | undefined, private readonly persist: (data: PersistedRepositoryIdentityData) => Promise<void>) {
    for (const [key, value] of Object.entries(data?.identities ?? {})) this.#identities.set(key, value as RepositoryId);
  }

  async getOrCreate(locator: RepositoryLocator): Promise<RepositoryId> {
    const key = locatorKey(locator);
    const existing = this.#identities.get(key);
    if (existing !== undefined) return existing;
    const created = randomUUID() as RepositoryId;
    this.#identities.set(key, created);
    await this.persist({ identities: Object.freeze(Object.fromEntries(this.#identities)) });
    return created;
  }
}
