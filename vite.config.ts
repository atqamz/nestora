import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

const persist = process.env.NESTORA_PERSIST_TO;

export default defineConfig({ plugins: [react(), cloudflare(persist ? { persistState: { path: persist } } : {})] });
