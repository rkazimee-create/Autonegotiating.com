import { defineConfig } from "vite";
import path from "path";

// PORT is only required when running the dev server or preview — not during builds
const isBuild = process.argv.includes("build");
const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 3000;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

export default defineConfig({
  base: "/",
  plugins: [],
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
    } : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
