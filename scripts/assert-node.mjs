const major = Number(process.versions.node.split(".")[0]);

if (!Number.isInteger(major) || major < 22) {
  process.stderr.write(`Node.js >= 22 required (running ${process.versions.node}).\n`);
  process.exit(1);
}
