import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path, { resolve } from "node:path";

// Separate entry and server. No production API proxy or VITE_* environment exposure.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: "RESKIN_PREVIEW_",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  preview: { host: "127.0.0.1", port: 5175, strictPort: true },
  build: {
    outDir: "dist/reskin-preview",
    rollupOptions: { input: { reskin: resolve(__dirname, "reskin-preview.html") } },
  },
});
