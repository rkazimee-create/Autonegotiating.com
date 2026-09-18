import { defineConfig } from "vite";
import path from "path";
import type { Plugin } from "vite";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function indexNowVerificationPlugin(): Plugin {
  const key = process.env.INDEXNOW_KEY;
  const valid = key && /^[A-Za-z0-9_-]{8,200}$/.test(key) ? key : undefined;
  return {
    name: "indexnow-verification",
    configureServer(server) {
      if (!valid) return;
      server.middlewares.use((req, res, next) => {
        if (req.url !== `/${valid}.txt`) return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(valid);
      });
    },
    generateBundle() {
      if (valid) this.emitFile({ type: "asset", fileName: `${valid}.txt`, source: valid });
    },
  };
}

export default defineConfig({
  base: "/",
  // The IndexNow verification filename contains the configured key. Suppress
  // Vite's per-asset info table so build logs never print that filename.
  logLevel: "warn",
  plugins: [indexNowVerificationPlugin()],
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        dealIntelligence: path.resolve(import.meta.dirname, "deal-intelligence.html"),
        tradeIntelligence: path.resolve(import.meta.dirname, "trade-intelligence.html"),
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: process.env.API_PORT ? {
      "/api": {
        target: `http://localhost:${process.env.API_PORT}`,
        changeOrigin: true,
      },
      "/vehicle": {
        target: `http://localhost:${process.env.API_PORT}`,
        changeOrigin: true,
      },
    } : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
