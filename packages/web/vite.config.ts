import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const contentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

const presetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../presets");

function presetPath(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }
  const pathOnly = url.split("?")[0] ?? "";
  const marker = "/presets/";
  const index = pathOnly.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const name = pathOnly.slice(index + marker.length);
  if (!/^[a-z0-9-]+\.json$/.test(name)) {
    return null;
  }
  const file = path.resolve(presetsDir, name);
  const root = `${presetsDir}${path.sep}`;
  if (!file.startsWith(root) || !existsSync(file)) {
    return null;
  }
  return file;
}

function sendPreset(url: string | undefined, response: ServerResponse): boolean {
  const file = presetPath(url);
  if (file === null) {
    return false;
  }
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(readFileSync(file));
  return true;
}

function perpsPresets(): Plugin {
  return {
    name: "perpdrill-presets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!sendPreset(req.url, res)) {
          next();
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!sendPreset(req.url, res)) {
          next();
        }
      });
    },
    writeBundle(options) {
      if (options.dir === undefined) {
        return;
      }
      const dest = path.join(options.dir, "presets");
      mkdirSync(dest, { recursive: true });
      for (const name of readdirSync(presetsDir)) {
        if (!name.endsWith(".json")) {
          continue;
        }
        copyFileSync(path.join(presetsDir, name), path.join(dest, name));
      }
    },
  };
}

// PAGES_BASE sets the public path (for example /perpdrill/ on GitHub Pages).
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  plugins: [perpsPresets()],
  build: { target: "es2022", sourcemap: false },
  server: {
    host: "127.0.0.1",
    port: 43127,
    strictPort: true,
    headers: {
      "Content-Security-Policy": contentSecurityPolicy,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 43127,
    strictPort: true,
    headers: {
      "Content-Security-Policy": contentSecurityPolicy,
    },
  },
});
