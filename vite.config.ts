import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [cloudflare()],
	define: {
		__BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
	},
});
