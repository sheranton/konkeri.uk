// Saves a snapshot of the GitHub data the site shows, used by the Worker when
// the GitHub API is rate-limited or unreachable. Run: npm run snapshot

import { writeFile } from "node:fs/promises";

const user = "sheranton";
const headers = {
	"User-Agent": "konkeri.uk snapshot",
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};

const firstLine = (text) =>
	((text ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "").replace(/^[-*]\s+/, "").trim().slice(0, 200);

const res = await fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=pushed&type=owner`, { headers });
if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
const repos = (await res.json())
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

for (const repo of repos) {
	const rr = await fetch(`https://api.github.com/repos/${user}/${repo.name}/releases?per_page=5`, { headers });
	if (!rr.ok) continue;
	repo.releases = (await rr.json())
		.filter((r) => !r.draft)
		.map((r) => ({ tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at, url: r.html_url, summary: firstLine(r.body) }));
}

const data = { user, fetchedAt: new Date().toISOString(), source: "snapshot", repos };
await writeFile(new URL("../src/github-snapshot.json", import.meta.url), JSON.stringify(data, null, "\t") + "\n");
console.log(`snapshot: ${repos.length} repos, ${repos.reduce((n, r) => n + r.releases.length, 0)} releases`);
