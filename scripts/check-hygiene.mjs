import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import "./assert-node.mjs";

const root = path.resolve(import.meta.dirname, "..");
const skipDirs = new Set(["node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".svg",
  ".json",
]);

const banned = [
  { name: "vest", re: /\bvest\b/i },
  { name: "vestmarkets", re: /vestmarkets/i },
  { name: "tradingview", re: /tradingview/i },
  { name: "tradeify", re: /tradeify/i },
  { name: "myfunded", re: /myfunded/i },
  { name: "candledrill", re: /candledrill/i },
  { name: "amber-accent", re: /#f2a93b/i },
  { name: "ancestor-slate", re: /#11151c/i },
];

const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(path.join(root, "packages"));
if (files.length === 0) {
  process.stderr.write("check:hygiene: no package files scanned\n");
  process.exit(1);
}

for (const file of files) {
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of banned) {
      if (rule.re.test(line)) {
        const relative = path.relative(root, file);
        failures.push(`${relative}:${index + 1} matched ${rule.name}`);
      }
    }
  }
}

const desk = await readFile(path.join(root, "packages/web/src/desk.ts"), "utf8");
const labelSource = await readFile(path.join(root, "packages/core/src/types.ts"), "utf8");
for (const phrase of ["Trading Power", "Liq. Price (Mark)", "Account Health"]) {
  if (!labelSource.includes(phrase)) {
    failures.push(`packages/core/src/types.ts is missing label ${phrase}`);
  }
}
for (const phrase of [
  "TRADING_POWER_LABEL",
  "LIQ_PRICE_MARK_LABEL",
  "ACCOUNT_HEALTH_LABEL",
  "Liquidation",
  "BUYING_POWER_PCTS",
  "disabled: true",
]) {
  if (!desk.includes(phrase)) {
    failures.push(`packages/web/src/desk.ts is missing placeholder ${phrase}`);
  }
}
if (desk.includes("Liq Risk") || labelSource.includes("Liq Risk")) {
  failures.push("Liq Risk is not an M0 label");
}

const html = await readFile(path.join(root, "packages/web/index.html"), "utf8");
if (!html.includes("default-src 'self'")) {
  failures.push("packages/web/index.html is missing CSP default-src 'self'");
}
if (!desk.includes("AGPL")) {
  failures.push("packages/web/src/desk.ts is missing the AGPL source link label");
}

if (failures.length > 0) {
  for (const message of failures) {
    process.stderr.write(`check:hygiene: ${message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`check:hygiene ok (${files.length} files)\n`);
