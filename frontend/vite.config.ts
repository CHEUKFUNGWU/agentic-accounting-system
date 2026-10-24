import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path, { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn components are generated with @/… imports.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000" },
  },
  build: {
    rollupOptions: {
      input: {
        // Supplied Monolith UI is the default web and desktop entry.
        main: resolve(__dirname, "index.html"),
        // Both existing public entry URLs open the supplied interface.
        app: resolve(__dirname, "app.html"),
        prototype: resolve(__dirname, "prototype.html"),
        readerPrototype: resolve(__dirname, "reader-prototype.html"),
        productPrototype: resolve(__dirname, "product-prototype.html"),
        connected: resolve(__dirname, "connected.html"),
        classic: resolve(__dirname, "classic.html"),
      },
    },
  },
});
