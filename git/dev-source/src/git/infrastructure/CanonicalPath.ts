import { realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, sep } from "node:path";

import type { CanonicalAbsolutePath } from "../../domain/RepoRelativePath";

const normalizePlatformCase = (value: string): string => {
  if (process.platform !== "win32") return value;
  const root = parse(value).root;
  return root.length === 0 ? value : `${root.toLocaleLowerCase("en-US")}${value.slice(root.length)}`;
};

export const normalizeCanonicalPath = (value: string): CanonicalAbsolutePath => {
  if (!isAbsolute(value)) throw new TypeError(`Expected absolute path: ${value}`);
  const normalized = normalizePlatformCase(normalize(value)).split(sep).join("/");
  return (normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized) as CanonicalAbsolutePath;
};

export const canonicalizeExistingPath = async (value: string): Promise<CanonicalAbsolutePath> =>
  normalizeCanonicalPath(await realpath(value));
