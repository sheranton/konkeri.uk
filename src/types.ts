// Shape of /api/github, shared by the Worker and the browser code.

export interface Release {
	tag: string;
	name: string;
	date: string;
	url: string;
	summary: string;
}

export interface Repo {
	name: string;
	description: string;
	language: string | null;
	stars: number;
	topics: string[];
	pushed: string;
	url: string;
	releases: Release[];
}

export interface GitHubData {
	user: string;
	fetchedAt: string;
	source: "live" | "snapshot";
	repos: Repo[];
}
