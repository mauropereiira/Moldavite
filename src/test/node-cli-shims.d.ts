/** Minimal Node declarations for CLI regression tests; the browser app ships no Node types. */
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string): void;
  export function rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
}

declare module 'node:process' {
  const process: {
    cwd(): string;
    execPath: string;
  };
  export default process;
}

declare module 'node:child_process' {
  interface SpawnSyncResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  export function spawnSync(
    command: string,
    args: string[],
    options: { encoding: 'utf8' }
  ): SpawnSyncResult;
}
