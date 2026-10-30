import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// PDF.js auxiliary decoders/fonts/CMaps stay local in dev and static builds.
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const pdfjsAssets = [{ path: "vendor/pdfjs/LICENSE", source: join(pdfjsRoot, "LICENSE") }, ...["cmaps", "standard_fonts", "wasm"].flatMap((directory) =>
  readdirSync(join(pdfjsRoot, directory)).map((filename) => ({
    path: `vendor/pdfjs/${directory}/${filename}`, source: join(pdfjsRoot, directory, filename),
  })))];

export default defineConfig({
  // Relative URLs let the same build run at a GitHub Pages project subpath,
  // a custom domain root, or any ordinary static HTTP directory.
  base: "./",
  plugins: [react(), {
    name: "local-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = pdfjsAssets.find((entry) => `/${entry.path}` === request.url?.split("?")[0]);
        if (!asset) return next();
        response.setHeader("Content-Type", asset.path.endsWith(".wasm") ? "application/wasm" : asset.path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.end(readFileSync(asset.source));
      });
    },
    generateBundle() {
      for (const asset of pdfjsAssets) this.emitFile({ type: "asset", fileName: asset.path, source: readFileSync(asset.source) });
    },
  }],
  server: {
    watch:
      process.env.CODEX_SANDBOX === "seatbelt"
        ? { useFsEvents: false, usePolling: true }
        : undefined,
  },
  worker: {
    format: "es",
  },
});
