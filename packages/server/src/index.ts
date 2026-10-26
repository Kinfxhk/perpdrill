import { createServer, type Server } from "node:http";
import { ENGINE_STATUS, PRODUCT_NAME, PRODUCT_VERSION } from "@perpdrill/core";

const DEFAULT_PORT = 47221;
const DEFAULT_HOST = "127.0.0.1";

export function versionLine(): string {
  return `${PRODUCT_NAME} ${PRODUCT_VERSION} (${ENGINE_STATUS})`;
}

function printVersion(): void {
  process.stdout.write(`${versionLine()}\n`);
}

function listen(port: number, host: string): Server {
  const server = createServer((_req, res) => {
    const body = `${versionLine()}\nengine: ${ENGINE_STATUS}\n`;
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  });
  server.listen(port, host, () => {
    process.stdout.write(`listening http://${host}:${port}\n${versionLine()}\n`);
  });
  return server;
}

function readPort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_PORT;
  }
  if (!/^[0-9]+$/.test(raw)) {
    return undefined;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  return port;
}

const arg = process.argv[2];

if (arg === undefined || arg === "print" || arg === "--version") {
  printVersion();
} else if (arg === "listen") {
  const port = readPort(process.env.PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;
  if (port === undefined) {
    process.stderr.write("PORT must be an integer from 1 to 65535\n");
    process.exitCode = 1;
  } else {
    listen(port, host);
  }
} else {
  process.stderr.write("usage: perpsdrill-server [print|listen]\n");
  process.exitCode = 1;
}
