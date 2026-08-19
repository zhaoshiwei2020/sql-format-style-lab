/**
 * Minimal ambient Node.js types for the test harness and dev scripts.
 *
 * @types/node is not installed anywhere in this workspace (checked: not in
 * node_modules, not in package-lock.json) and adding it is out of scope
 * ("no new npm dependencies"). This file declares only the small surface
 * actually used by packages/core/test/**\/*.ts and packages/core/scripts/**\/*.ts
 * so those files typecheck under packages/core/tsconfig.test.json. It is
 * intentionally NOT included by packages/core/tsconfig.json (src only), so
 * it has no effect on the contract source files.
 */

declare module "node:fs" {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function basename(p: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

declare module "node:module" {
  export function register(specifier: string, parentURL?: string, options?: unknown): void;
}

declare var process: {
  argv: string[];
  exit(code?: number): never;
};

declare var console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

interface ImportMeta {
  url: string;
}
