import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import "./assert-node.mjs";

const root = path.resolve(import.meta.dirname, "..");
const skipDirs = new Set(["node_modules", "dist", "coverage", ".git", "uploads"]);
const skipFiles = new Set(["package-lock.json", "LICENSE"]);

const rules = [
  { name: "private-key", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-pat", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "github-token", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "stripe-live", re: /\bsk_live_[0-9a-zA-Z]{16,}/ },
  {
    name: "assigned-secret",
    re: /(?:api[_-]?key|client[_-]?secret|password|secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  },
];

const gitleaks = await readFile(path.join(root, ".gitleaks.toml"), "utf8");
const requiredConfig = ["useDefault = true", "[allowlist]", "package-lock", "LICENSE"];
const failures = [];

for (const phrase of requiredConfig) {
  if (!gitleaks.includes(phrase)) {
    failures.push(`.gitleaks.toml is missing ${phrase}`);
  }
}

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
    } else if (entry.isFile() && !skipFiles.has(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(root);

for (const file of files) {
  const buffer = await readFile(file);
  if (buffer.includes(0) || buffer.length > 1_000_000) {
    continue;
  }
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of rules) {
      if (rule.re.test(line)) {
        const relative = path.relative(root, file);
        failures.push(`${relative}:${index + 1} matched ${rule.name}`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const message of failures) {
    process.stderr.write(`check:secrets: ${message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`check:secrets ok (${files.length} files)\n`);
