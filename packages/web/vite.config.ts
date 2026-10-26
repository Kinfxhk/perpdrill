import { defineConfig } from "vite";

const contentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

// PAGES_BASE sets the public path (for example /perpdrill/ on GitHub Pages).
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
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
