import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "konkeri",
		compatibilityDate: "2026-10-06",
		entrypoint,
		env: {
			ASSETS: bindings.assets(),
			GITHUB_USER: bindings.text("sheranton"),
		},
		// Every request goes through the Worker so it can redirect www, serve
		// /api/github and add security headers before the static assets.
		assets: {
			htmlHandling: "auto-trailing-slash",
			notFoundHandling: "404-page",
			runWorkerFirst: true,
		},
		domains: ["konkeri.uk", "www.konkeri.uk"],
		workersDev: false,
		observability: { enabled: true },
	},
});
