#!/usr/bin/env node
// Sync the app version across package.json, tauri.conf.json, Cargo.toml, and
// Cargo.lock. Usage: node scripts/bump-version.mjs 1.4.0
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}

// package.json
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// tauri.conf.json
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

// Cargo.toml — first `version = "..."` under [package]
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');
let cargo = readFileSync(cargoPath, 'utf8');
cargo = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`
);
writeFileSync(cargoPath, cargo);

// Cargo.lock — the [[package]] block whose name = "moldavite"
const lockPath = join(root, 'src-tauri', 'Cargo.lock');
let lock = readFileSync(lockPath, 'utf8');
lock = lock.replace(
  /(name = "moldavite"\nversion = ")[^"]+(")/,
  `$1${version}$2`
);
writeFileSync(lockPath, lock);

console.log(`Bumped version to ${version} in package.json, tauri.conf.json, Cargo.toml, Cargo.lock`);
