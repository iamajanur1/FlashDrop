import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  envPrefix: ["VITE_", "REACT_APP_"],

  server: {
    host: "0.0.0.0",
    allowedHosts: [
      "flashdropp.up.railway.app",
    ],
  },

  build: {
    target: "es2020",
    sourcemap: false,
  },
});