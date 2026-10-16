// konkeri.uk Worker: canonical-host redirect, a cached GitHub API endpoint,
// and security headers in front of the static site.

import snapshot from "./github-snapshot.json";
import type { GitHubData, Repo } from "./types.ts";

interface Env {
	ASSETS: Fetcher;
	GITHUB_USER: string;
	/** Optional read-only token. Without one, GitHub allows 60 requests an hour per IP, and Cloudflare's IPs are shared. */
	GITHUB_TOKEN?: string;
}

const CACHE_KEY = "https://konkeri.uk/__cache/github/v3";
const CACHE_SECONDS = 3600;
/** The last complete live response, kept for a week as a better fallback than the build-time snapshot. */
const LAST_GOOD_KEY = "https://konkeri.uk/__cache/github/last-good/v1";
const LAST_GOOD_SECONDS = 7 * 24 * 3600;
/** Repositories that aren't projects: the site's own source. (The profile README repo is filtered by name below.) */
const HIDDEN = new Set(["konkeri.uk"]);

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

async function fetchGitHub(user: string, token?: string): Promise<GitHubData> {
	const headers: Record<string, string> = {
		"User-Agent": "konkeri.uk",
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=pushed&type=owner`, { headers });
	if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
	const raw = (await res.json()) as any[];
	const repos: Repo[] = raw
		.filter((r) => !r.fork && !r.private && !r.archived && r.name !== user && !HIDDEN.has(r.name))
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
			// A rate-limited release lookup must fail the whole fetch, not cache a list with releases missing.
			if (!rr.ok) throw new Error(`GitHub API returned ${rr.status} for ${repo.name} releases`);
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
	let fresh = true;
	let why = "live";
	try {
		data = await fetchGitHub(env.GITHUB_USER, env.GITHUB_TOKEN);
		const keep = new Response(JSON.stringify(data), {
			headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${LAST_GOOD_SECONDS}` },
		});
		ctx.waitUntil(cache.put(LAST_GOOD_KEY, keep));
	} catch (err) {
		// Rate-limited or unreachable: the last complete live copy, else the snapshot taken at build time.
		fresh = false;
		const last = await cache.match(LAST_GOOD_KEY);
		data = last ? ((await last.json()) as GitHubData) : { ...(snapshot as GitHubData), source: "snapshot" };
		why = `${last ? "last-good" : "snapshot"}; ${err instanceof Error ? err.message : "fetch failed"}`;
	}
	const body = JSON.stringify(data);
	const response = new Response(body, {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": `public, max-age=${fresh ? CACHE_SECONDS : 300}`,
			"X-Data-Source": why,
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
