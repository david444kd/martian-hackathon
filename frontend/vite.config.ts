import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// `npm run dev:quest` serves over HTTPS on the local network so the Quest browser can open the dev
// server (WebXR needs HTTPS). Not needed for the deployed site, which is HTTPS already.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "quest" ? [basicSsl()] : [])],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: mode === "quest" ? { host: true } : {},
}));
