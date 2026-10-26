import { defineConfig } from "vite";

const contentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

export default defineConfig({
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
