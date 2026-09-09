import { rmSync } from "node:fs";

/** Každý běh E2E začíná s čistou demo databází a úložištěm. */
export default function globalSetup() {
  rmSync(".data/pglite-e2e", { recursive: true, force: true });
  rmSync(".data/storage-e2e", { recursive: true, force: true });
}
