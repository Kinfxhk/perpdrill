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
const constants = await readFile(path.join(root, "packages/core/src/constants.ts"), "utf8");
const i18n = await readFile(path.join(root, "packages/web/src/i18n.ts"), "utf8");
for (const phrase of ["Trading Power", "Liq. Price (Mark)", "Account Health", "Liq Risk"]) {
  if (!labelSource.includes(phrase)) {
    failures.push(`packages/core/src/types.ts is missing label ${phrase}`);
  }
}
for (const phrase of ["BUYING_POWER_PCTS", 'className: "orders"', "legend-liq", "AGPL"]) {
  if (!desk.includes(phrase)) {
    failures.push(`packages/web/src/desk.ts is missing ${phrase}`);
  }
}
if (!constants.includes("DEFAULT_SLIP_TOLERANCE_BPS = 75")) {
  failures.push("majors slip tolerance default must be 75 bps");
}
if (!constants.includes("DEFAULT_REALIZED_IMPACT_BPS = 25")) {
  failures.push("majors realized impact default must be 25 bps");
}
if (constants.includes("DEFAULT_SLIP_TOLERANCE_BPS = 500")) {
  failures.push("majors slip tolerance must not default to 5%");
}
for (const phrase of [
  "SUPPORTED_LANGS",
  "zh-Hant",
  "zh-Hans",
  "ja",
  "ko",
  "Liquidation",
  "Liq Risk",
]) {
  if (!i18n.includes(phrase)) {
    failures.push(`packages/web/src/i18n.ts is missing ${phrase}`);
  }
}

const html = await readFile(path.join(root, "packages/web/index.html"), "utf8");
if (!html.includes("default-src 'self'")) {
  failures.push("packages/web/index.html is missing CSP default-src 'self'");
}

await assertPresets(root, failures);
await assertNoPropFirmMatch(root, failures);

async function assertPresets(repoRoot, sink) {
  const dir = path.join(repoRoot, "presets");
  const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
  const files = index.files;
  if (!Array.isArray(files) || files.length !== 13) {
    sink.push("presets/index.json must list the 13 teaching plans");
    return;
  }
  const loaded = new Map();
  for (const name of files) {
    if (typeof name !== "string" || !/^[a-z0-9-]+\.json$/.test(name)) {
      sink.push(`presets/index.json has an unsafe file name ${String(name)}`);
      continue;
    }
    if (name.startsWith("community-")) {
      sink.push(`${name} is a retired community preset`);
      continue;
    }
    loaded.set(name, JSON.parse(await readFile(path.join(dir, name), "utf8")));
  }
  const unofficial = "Unofficial community preset — verify against current official docs.";
  const firmName = /myfunded|vestmarkets|\bvest\b|tradeify/i;
  const shownFields = ["displayName", "group", "disclaimer", "note"];
  for (const file of loaded.values()) {
    if (typeof file.disclaimer !== "string" || !file.disclaimer.includes(unofficial)) {
      sink.push(`${file.id ?? "preset"} is missing the unofficial disclaimer`);
    }
    if (!Array.isArray(file.sourceUrls) || file.sourceUrls.length === 0) {
      sink.push(`${file.id ?? "preset"} is missing source URLs`);
    }
    if (typeof file.id === "string" && file.id.startsWith("community-")) {
      sink.push(`${file.id} is a retired community preset`);
    }
    for (const field of shownFields) {
      if (typeof file[field] === "string" && firmName.test(file[field])) {
        sink.push(`${file.id ?? "preset"} ${field} contains a firm name`);
      }
    }
  }
  const ladder = {
    "plan-instant-0-5k.json": {
      displayName: "Teaching · Instant 500",
      startingBalanceUsd: 500,
      maxDrawdownUsd: 10,
      profitTargetPct: null,
      dailyLossLimitPct: null,
    },
    "plan-instant-5k.json": {
      displayName: "Teaching · Instant 5k",
      startingBalanceUsd: 5000,
      maxDrawdownUsd: 200,
      profitTargetPct: null,
      dailyLossLimitPct: null,
    },
    "plan-instant-10k.json": {
      displayName: "Teaching · Instant 10k",
      startingBalanceUsd: 10000,
      maxDrawdownUsd: 400,
      profitTargetPct: null,
      dailyLossLimitPct: null,
    },
    "plan-instant-25k.json": {
      displayName: "Teaching · Instant 25k",
      startingBalanceUsd: 25000,
      maxDrawdownUsd: 1000,
      profitTargetPct: null,
      dailyLossLimitPct: null,
    },
    "plan-instant-50k.json": {
      displayName: "Teaching · Instant 50k",
      startingBalanceUsd: 50000,
      maxDrawdownUsd: 2000,
      profitTargetPct: null,
      dailyLossLimitPct: null,
    },
    "plan-1step-silver.json": {
      displayName: "Teaching · Eval Silver",
      startingBalanceUsd: 5000,
      maxDrawdownUsd: 300,
      profitTargetPct: 10,
      dailyLossLimitPct: null,
    },
    "plan-1step-gold.json": {
      displayName: "Teaching · Eval Gold",
      startingBalanceUsd: 10000,
      maxDrawdownUsd: 600,
      profitTargetPct: 10,
      dailyLossLimitPct: null,
    },
    "plan-1step-platinum.json": {
      displayName: "Teaching · Eval Platinum",
      startingBalanceUsd: 25000,
      maxDrawdownUsd: 1500,
      profitTargetPct: 10,
      dailyLossLimitPct: null,
    },
    "plan-1step-emerald.json": {
      displayName: "Teaching · Eval Emerald",
      startingBalanceUsd: 50000,
      maxDrawdownUsd: 3000,
      profitTargetPct: 10,
      dailyLossLimitPct: null,
    },
    "plan-2step-silver.json": {
      displayName: "Teaching · 2-Step Silver",
      startingBalanceUsd: 5000,
      maxDrawdownUsd: 300,
      profitTargetPct: 10,
      dailyLossLimitPct: 3,
    },
    "plan-2step-gold.json": {
      displayName: "Teaching · 2-Step Gold",
      startingBalanceUsd: 10000,
      maxDrawdownUsd: 600,
      profitTargetPct: 10,
      dailyLossLimitPct: 3,
    },
    "plan-2step-platinum.json": {
      displayName: "Teaching · 2-Step Platinum",
      startingBalanceUsd: 25000,
      maxDrawdownUsd: 1500,
      profitTargetPct: 10,
      dailyLossLimitPct: 3,
    },
    "plan-2step-emerald.json": {
      displayName: "Teaching · 2-Step Emerald",
      startingBalanceUsd: 50000,
      maxDrawdownUsd: 3000,
      profitTargetPct: 10,
      dailyLossLimitPct: 3,
    },
  };
  for (const [name, expected] of Object.entries(ladder)) {
    const file = loaded.get(name);
    if (file === undefined) {
      sink.push(`presets/index.json is missing ${name}`);
      continue;
    }
    expectFields(sink, file.id ?? name, file, expected);
    if (file.drawdownMode !== "static") {
      sink.push(`${file.id} max drawdown must be static`);
    }
    if (
      !name.startsWith("plan-instant-") &&
      (file.dailyReset?.timeZone !== "America/New_York" || file.dailyReset?.hour !== 20)
    ) {
      sink.push(`${file.id} daily reset must be 20:00 America/New_York`);
    }
  }
  const desk = await readFile(path.join(repoRoot, "packages/web/src/desk.ts"), "utf8");
  if (desk.includes("text: url")) {
    sink.push("preset source URLs must not be used as visible link text");
  }
}

function expectFields(sink, id, file, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (file[key] !== value) {
      sink.push(`${id} ${key} must be ${JSON.stringify(value)}`);
    }
  }
}

async function assertNoPropFirmMatch(repoRoot, sink) {
  const skip = new Set(["node_modules", "dist", "coverage", ".git", "uploads"]);
  const extensions = new Set([...textExtensions, ".md"]);
  const blocked = "PropFirm" + " Match";
  const files = await walkText(repoRoot, skip, extensions);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (text.toLowerCase().includes(blocked.toLowerCase())) {
      sink.push(`${path.relative(repoRoot, file)} mentions a blocked directory phrase`);
    }
  }
}

async function walkText(dir, skip, extensions) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skip.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkText(full, skip, extensions)));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

if (failures.length > 0) {
  for (const message of failures) {
    process.stderr.write(`check:hygiene: ${message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`check:hygiene ok (${files.length} files)\n`);
