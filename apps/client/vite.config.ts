import { defineConfig } from "vite";
import { villageSiegePwa } from "./build/pwaPlugin";

export default defineConfig({
  plugins: [villageSiegePwa()],
  server: { host: "0.0.0.0", port: 5173 },
  preview: { host: "0.0.0.0", port: 4173 },
  build: { target: "es2022" }
});
