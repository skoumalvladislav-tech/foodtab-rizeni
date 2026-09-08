import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafePath, type StorageProvider } from "./index.ts";

/** Soubory na disku — jen pro vývoj a demo. */
export function createLocalStorage(root: string): StorageProvider {
  return {
    key: "local",
    async put(storagePath, data) {
      assertSafePath(storagePath);
      const full = path.join(root, storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    },
    async get(storagePath) {
      assertSafePath(storagePath);
      try {
        return new Uint8Array(await readFile(path.join(root, storagePath)));
      } catch {
        return null;
      }
    },
    async remove(storagePath) {
      assertSafePath(storagePath);
      await rm(path.join(root, storagePath), { force: true });
    },
  };
}
