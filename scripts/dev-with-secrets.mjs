#!/usr/bin/env node
/**
 * Run `tauri dev` with the compile-time credentials from `.env.local`.
 *
 * The Google and WordPress.com client credentials are read by `option_env!`,
 * which resolves when **cargo compiles**, not when the app runs. So they have
 * to be in the environment of the build, which is why this exists rather than
 * a runtime dotenv loader.
 *
 * `.env.local` is gitignored. Nothing here prints a value: a secret that ends
 * up in a terminal scrollback, a screenshot or a bug report has leaked.
 *
 * Run: npm run dev:app
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

/** Keys this script is willing to pass through, so a stray line in the file
 *  cannot quietly inject something else into the build. */
const ALLOWED = new Set([
  'MOLDAVITE_GOOGLE_CLIENT_ID',
  'MOLDAVITE_GOOGLE_CLIENT_SECRET',
  'MOLDAVITE_WPCOM_CLIENT_ID',
  'MOLDAVITE_WPCOM_CLIENT_SECRET',
]);

const env = { ...process.env };
const loaded = [];

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!ALLOWED.has(key)) continue;
    // Strip one layer of surrounding quotes, which people add out of habit.
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (!value) continue;
    env[key] = value;
    loaded.push(key);
  }
}

// Names only. Never values.
console.log(
  loaded.length
    ? `Loaded from .env.local: ${loaded.join(', ')}`
    : 'No .env.local found — features needing compile-time credentials will report themselves unavailable.'
);

const child = spawn('npx', ['tauri', 'dev'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
