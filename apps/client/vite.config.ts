import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { villageSiegePwa } from "./build/pwaPlugin";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [villageSiegePwa()],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
  build: { target: "es2022" }
});
