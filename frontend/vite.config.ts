import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths, so the build works under /crime-map/ on GitHub
  // Pages, on a custom domain, or from any other sub-path.
  base: "./",
  plugins: [preact()],
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
