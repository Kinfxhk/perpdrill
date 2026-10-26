import { readFile } from "node:fs/promises";
import path from "node:path";
import "./assert-node.mjs";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

const license = await readFile(path.join(root, "LICENSE"), "utf8");
if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  fail("LICENSE is missing the Affero GPL heading");
}
if (!license.includes("Version 3, 19 November 2007")) {
  fail("LICENSE is missing the AGPL version line");
}
if (license.length < 20000) {
  fail("LICENSE looks truncated");
}

const notice = await readFile(path.join(root, "NOTICE"), "utf8");
for (const phrase of ["KINFX", "Kinfxhk", "2026", "CandleDrill", "AGPL-3.0-or-later"]) {
  if (!notice.includes(phrase)) {
    fail(`NOTICE is missing ${phrase}`);
  }
}

const thirdParty = await readFile(path.join(root, "THIRD_PARTY_NOTICES"), "utf8");
for (const phrase of ["TypeScript", "Vite", "Vitest", "ESLint", "Prettier", "Apache-2.0", "MIT"]) {
  if (!thirdParty.includes(phrase)) {
    fail(`THIRD_PARTY_NOTICES is missing ${phrase}`);
  }
}

const manifests = [
  "package.json",
  "packages/core/package.json",
  "packages/web/package.json",
  "packages/server/package.json",
];

for (const relativePath of manifests) {
  const manifest = JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  if (manifest.license !== "AGPL-3.0-or-later") {
    fail(`${relativePath} license must be AGPL-3.0-or-later`);
  }
  if (manifest.private !== true) {
    fail(`${relativePath} must stay private`);
  }
}

if (failures.length > 0) {
  for (const message of failures) {
    process.stderr.write(`check:licenses: ${message}\n`);
  }
  process.exit(1);
}

process.stdout.write("check:licenses ok\n");
