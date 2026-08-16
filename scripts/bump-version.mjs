#!/usr/bin/env node
// Keep the app version synchronized across all five release manifests.
// Usage:
//   node scripts/bump-version.mjs 2.2.0
//   node scripts/bump-version.mjs --check
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(message);
}

function assertVersion(value, label) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    fail(`${label}: expected an x.y.z version, found ${JSON.stringify(value)}`);
  }
  return value;
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    fail(`${label}: invalid JSON (${error.message})`);
  }
}

function replaceExactlyOnce(contents, pattern, replacement, label) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${label}: expected exactly one version match, found ${matches.length}`);
  }

  assertVersion(matches[0][2], label);
  return contents.replace(pattern, (...args) => replacement(args[1], args[3]));
}

const manifests = [
  {
    label: 'package.json',
    path: join(root, 'package.json'),
    readVersion(contents) {
      const value = parseJson(contents, this.label);
      if (value.name !== 'moldavite' || !Object.hasOwn(value, 'version')) {
        fail(`${this.label}: expected the moldavite root version field`);
      }
      return assertVersion(value.version, this.label);
    },
    transform(contents, version) {
      const value = parseJson(contents, this.label);
      this.readVersion(contents);
      value.version = version;
      return `${JSON.stringify(value, null, 2)}\n`;
    },
  },
  {
    label: 'package-lock.json',
    path: join(root, 'package-lock.json'),
    readVersion(contents) {
      const value = parseJson(contents, this.label);
      const rootPackage = value.packages?.[''];
      if (
        value.name !== 'moldavite' ||
        rootPackage?.name !== 'moldavite' ||
        !Object.hasOwn(value, 'version') ||
        !Object.hasOwn(rootPackage, 'version')
      ) {
        fail(`${this.label}: expected both moldavite root version fields`);
      }

      const lockVersion = assertVersion(value.version, `${this.label} root`);
      const packageVersion = assertVersion(rootPackage.version, `${this.label} packages[\"\"]`);
      if (lockVersion !== packageVersion) {
        fail(
          `${this.label}: root version ${lockVersion} does not match packages[\"\"] version ${packageVersion}`
        );
      }
      return lockVersion;
    },
    transform(contents, version) {
      const value = parseJson(contents, this.label);
      this.readVersion(contents);
      value.version = version;
      value.packages[''].version = version;
      return `${JSON.stringify(value, null, 2)}\n`;
    },
  },
  {
    label: 'src-tauri/tauri.conf.json',
    path: join(root, 'src-tauri', 'tauri.conf.json'),
    readVersion(contents) {
      const value = parseJson(contents, this.label);
      if (value.productName !== 'Moldavite' || !Object.hasOwn(value, 'version')) {
        fail(`${this.label}: expected the Moldavite root version field`);
      }
      return assertVersion(value.version, this.label);
    },
    transform(contents, version) {
      const value = parseJson(contents, this.label);
      this.readVersion(contents);
      value.version = version;
      return `${JSON.stringify(value, null, 2)}\n`;
    },
  },
  {
    label: 'src-tauri/Cargo.toml',
    path: join(root, 'src-tauri', 'Cargo.toml'),
    pattern: /(\[package\]\r?\nname\s*=\s*"moldavite"\r?\nversion\s*=\s*")([^"\r\n]+)(")/g,
    readVersion(contents) {
      const matches = [...contents.matchAll(this.pattern)];
      if (matches.length !== 1) {
        fail(`${this.label}: expected exactly one version match, found ${matches.length}`);
      }
      return assertVersion(matches[0][2], this.label);
    },
    transform(contents, version) {
      return replaceExactlyOnce(contents, this.pattern, (before, after) => {
        return `${before}${version}${after}`;
      }, this.label);
    },
  },
  {
    label: 'src-tauri/Cargo.lock',
    path: join(root, 'src-tauri', 'Cargo.lock'),
    pattern: /(\[\[package\]\]\r?\nname\s*=\s*"moldavite"\r?\nversion\s*=\s*")([^"\r\n]+)(")/g,
    readVersion(contents) {
      const matches = [...contents.matchAll(this.pattern)];
      if (matches.length !== 1) {
        fail(`${this.label}: expected exactly one version match, found ${matches.length}`);
      }
      return assertVersion(matches[0][2], this.label);
    },
    transform(contents, version) {
      return replaceExactlyOnce(contents, this.pattern, (before, after) => {
        return `${before}${version}${after}`;
      }, this.label);
    },
  },
];

function usage() {
  console.error('Usage: node scripts/bump-version.mjs <x.y.z> | --check');
  process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === '--check';
  const requestedVersion = !checkOnly && args.length === 1 ? args[0] : undefined;

  if (!checkOnly && (!requestedVersion || !VERSION_PATTERN.test(requestedVersion))) {
    usage();
    return;
  }

  // Read and validate every input before computing any output. A malformed
  // final manifest must not leave the first four already rewritten.
  const inputs = manifests.map((manifest) => {
    const contents = readFileSync(manifest.path, 'utf8');
    return { manifest, contents, version: manifest.readVersion(contents) };
  });

  if (checkOnly) {
    const expected = inputs[0].version;
    const mismatches = inputs.filter(({ version }) => version !== expected);
    if (mismatches.length > 0) {
      const versions = inputs
        .map(({ manifest, version }) => `${manifest.label}=${version}`)
        .join(', ');
      fail(`version mismatch: ${versions}`);
    }

    console.log(`Version ${expected} is synchronized across all five manifests`);
    return;
  }

  // Finish every transformation before the first write for the same reason.
  const outputs = inputs.map(({ manifest, contents }) => ({
    manifest,
    contents: manifest.transform(contents, requestedVersion),
  }));

  for (const { manifest, contents } of outputs) {
    writeFileSync(manifest.path, contents);
  }

  const names = manifests.map(({ path }) => relative(root, path)).join(', ');
  console.log(`Bumped version to ${requestedVersion} in ${names}`);
}

try {
  main();
} catch (error) {
  console.error(`Version manifest error: ${error.message}`);
  process.exitCode = 1;
}
