import type { MakeDirectoryOptions, Mode, PathLike, RmOptions, Stats, WriteFileOptions } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";

export interface SafetyDirectoryEntry { readonly name: string; readonly isDirectory: boolean; readonly isFile: boolean; readonly isSymbolicLink: boolean; }

/** Injectable byte-oriented filesystem boundary used by backup, verification, restore and fault tests. */
export interface SafetyFileSystem {
  mkdir(path: PathLike, options?: MakeDirectoryOptions & { readonly recursive?: boolean }): Promise<string | undefined>;
  mkdtemp(prefix: string): Promise<string>;
  realpath(path: PathLike): Promise<string>;
  stat(path: PathLike): Promise<Stats>;
  lstat(path: PathLike): Promise<Stats>;
  readdir(path: PathLike): Promise<readonly SafetyDirectoryEntry[]>;
  readFile(path: PathLike): Promise<Buffer>;
  writeFile(path: PathLike, data: Uint8Array | string, options?: WriteFileOptions): Promise<void>;
  readlink(path: PathLike): Promise<string>;
  symlink(target: string, path: PathLike, type?: "dir" | "file" | "junction"): Promise<void>;
  chmod(path: PathLike, mode: Mode): Promise<void>;
  copyFile(source: PathLike, destination: PathLike): Promise<void>;
  rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
  unlink(path: PathLike): Promise<void>;
  rm(path: PathLike, options?: RmOptions): Promise<void>;
}

export class NodeSafetyFileSystem implements SafetyFileSystem {
  mkdir(path: PathLike, options?: MakeDirectoryOptions & { readonly recursive?: boolean }): Promise<string | undefined> { return mkdir(path, options); }
  mkdtemp(prefix: string): Promise<string> { return mkdtemp(prefix); }
  realpath(path: PathLike): Promise<string> { return realpath(path); }
  stat(path: PathLike): Promise<Stats> { return stat(path); }
  lstat(path: PathLike): Promise<Stats> { return lstat(path); }
  async readdir(path: PathLike): Promise<readonly SafetyDirectoryEntry[]> {
    return (await readdir(path, { withFileTypes: true })).map((entry) => Object.freeze({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(), isSymbolicLink: entry.isSymbolicLink() }));
  }
  readFile(path: PathLike): Promise<Buffer> { return readFile(path); }
  writeFile(path: PathLike, data: Uint8Array | string, options?: WriteFileOptions): Promise<void> { return writeFile(path, data, options); }
  readlink(path: PathLike): Promise<string> { return readlink(path); }
  symlink(target: string, path: PathLike, type?: "dir" | "file" | "junction"): Promise<void> { return symlink(target, path, type); }
  chmod(path: PathLike, mode: Mode): Promise<void> { return chmod(path, mode); }
  copyFile(source: PathLike, destination: PathLike): Promise<void> { return copyFile(source, destination); }
  rename(oldPath: PathLike, newPath: PathLike): Promise<void> { return rename(oldPath, newPath); }
  unlink(path: PathLike): Promise<void> { return unlink(path); }
  rm(path: PathLike, options?: RmOptions): Promise<void> { return rm(path, options); }
}
