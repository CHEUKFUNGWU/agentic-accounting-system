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
  },
  build: {
    rollupOptions: {
      input: {
        // Superseded build kept for reference until the app replaces it.
        main: resolve(__dirname, "index.html"),
        // The application (role-scoped shell, six pages).
        app: resolve(__dirname, "app.html"),
        prototype: resolve(__dirname, "prototype.html"),
      },
    },
  },
});
