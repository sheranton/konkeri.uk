// konkeri.uk Worker: canonical-host redirect, a cached GitHub API endpoint,
// and security headers in front of the static site.

import snapshot from "./github-snapshot.json";
import type { GitHubData, Repo } from "./types.ts";

interface Env {
	ASSETS: Fetcher;
	GITHUB_USER: string;
}

const CACHE_KEY = "https://konkeri.uk/__cache/github/v2";
const CACHE_SECONDS = 3600;

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy":
		"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
		"connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
	"Strict-Transport-Security": "max-age=31536000",
	"Cross-Origin-Opener-Policy": "same-origin",
};

function withHeaders(response: Response, extra: Record<string, string> = {}): Response {
	const out = new Response(response.body, response);
	for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) out.headers.set(k, v);
	return out;
}

function firstLine(text: string | null): string {
	const line = (text ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
	return line.replace(/^[-*]\s+/, "").trim().slice(0, 200);
}

async function fetchGitHub(user: string): Promise<GitHubData> {
	const headers = {
		"User-Agent": "konkeri.uk",
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const res = await fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=pushed&type=owner`, { headers });
	if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
	const raw = (await res.json()) as any[];
	const repos: Repo[] = raw
		.filter((r) => !r.fork && !r.private && !r.archived && r.name !== user)
		.map((r) => ({
			name: r.name,
			description: r.description ?? "",
			language: r.language,
			stars: r.stargazers_count,
			topics: r.topics ?? [],
			pushed: r.pushed_at,
			url: r.html_url,
			releases: [],
		}));
	await Promise.all(
		repos.map(async (repo) => {
			const rr = await fetch(`https://api.github.com/repos/${user}/${repo.name}/releases?per_page=5`, { headers });
			if (!rr.ok) return;
			const releases = (await rr.json()) as any[];
			repo.releases = releases
				.filter((r) => !r.draft)
				.map((r) => ({
					tag: r.tag_name,
					name: r.name || r.tag_name,
					date: r.published_at,
					url: r.html_url,
					summary: firstLine(r.body),
				}));
		}),
	);
	return { user, fetchedAt: new Date().toISOString(), source: "live", repos };
}

async function githubEndpoint(env: Env, ctx: ExecutionContext): Promise<Response> {
	const cache = caches.default;
	const cached = await cache.match(CACHE_KEY);
	if (cached) return cached;

	let data: GitHubData;
	try {
		data = await fetchGitHub(env.GITHUB_USER);
	} catch {
		// Rate-limited or unreachable: serve the snapshot taken at build time.
		data = { ...(snapshot as GitHubData), source: "snapshot" };
	}
	const body = JSON.stringify(data);
	const response = new Response(body, {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": `public, max-age=${data.source === "live" ? CACHE_SECONDS : 300}`,
		},
	});
	ctx.waitUntil(cache.put(CACHE_KEY, response.clone()));
	return response;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// One canonical origin, https://konkeri.uk (localhost is left alone for dev).
		if (url.hostname === "www.konkeri.uk" || (url.hostname === "konkeri.uk" && url.protocol === "http:")) {
			url.hostname = "konkeri.uk";
			url.protocol = "https:";
			return Response.redirect(url.toString(), 301);
		}

		if (url.pathname === "/api/github") {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return withHeaders(new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }));
			}
			return withHeaders(await githubEndpoint(env, ctx));
		}

		const asset = await env.ASSETS.fetch(request);
		const immutable: Record<string, string> = url.pathname.startsWith("/assets/")
			? { "Cache-Control": "public, max-age=31536000, immutable" }
			: {};
		return withHeaders(asset, immutable);
	},
} satisfies ExportedHandler<Env>;
