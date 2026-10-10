import "@fontsource-variable/martian-mono/standard.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import "./style.css";
import { hilbert } from "./hilbert.ts";
import { OUTPUTS, type Line } from "./outputs.ts";
import type { GitHubData, Repo } from "./types.ts";

// ---------------------------------------------------------------- helpers
type Child = Node | string | null | undefined | false;

function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") el.className = v;
		else el.setAttribute(k, v);
	}
	for (const c of children) if (c) el.append(c);
	return el;
}

const $ = (id: string) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hex = (n: number, width = 6) => `0x${Math.max(0, Math.round(n)).toString(16).padStart(width, "0")}`;
const day = (iso: string) => iso.slice(0, 10);
const longDay = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function ago(iso: string): string {
	const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
	const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
	for (const [size, name] of units) {
		const n = Math.floor(seconds / size);
		if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
	}
	return "just now";
}

function listing(lines: Line[]): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const segs of lines) {
		const line = h("span", { class: "ln" });
		for (const [text, cls] of segs) line.append(cls ? h("span", { class: `o-${cls}` }, text) : text);
		frag.append(line);
	}
	return frag;
}

// ------------------------------------------------------------------ theme
function initTheme() {
	const root = document.documentElement;
	const dark = window.matchMedia("(prefers-color-scheme: dark)");
	const current = () => root.dataset.theme ?? (dark.matches ? "ink" : "paper");
	const buttons = document.querySelectorAll<HTMLButtonElement>("[data-theme-set]");
	const sync = () => buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === current())));
	for (const b of buttons) {
		b.addEventListener("click", () => {
			const theme = b.dataset.themeSet!;
			root.dataset.theme = theme;
			try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
			sync();
		});
	}
	dark.addEventListener("change", sync);
	sync();
}

// ----------------------------------------------- hero: bytes decode to text
function decodeName() {
	if (reduceMotion) return;
	const HEX = "0123456789abcdef";
	document.querySelectorAll<HTMLElement>(".name .ch b").forEach((b, i) => {
		const final = b.textContent ?? "";
		const steps = 6 + i * 2;
		let n = 0;
		b.textContent = HEX[(Math.random() * 16) | 0];
		b.classList.add("scramble");
		const tick = () => {
			if (++n >= steps) {
				b.textContent = final;
				b.classList.remove("scramble");
				return;
			}
			b.textContent = HEX[(Math.random() * 16) | 0];
			setTimeout(tick, 42);
		};
		setTimeout(tick, 160 + i * 30);
	});
}

// ------------------------------------------- Fig. 1: the binary, mapped
async function initFigure() {
	const plate = $("fig-plate");
	const readout = $("fig-readout");
	if (!plate || !readout) return;
	let svg: SVGSVGElement;
	try {
		const text = await (await fetch("/fig-unwind-map.svg")).text();
		const doc = new DOMParser().parseFromString(text, "image/svg+xml");
		if (doc.documentElement.nodeName !== "svg") return;
		svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
	} catch {
		const img = document.createElement("img");
		img.src = "/fig-unwind-map.svg";
		img.alt = "Hilbert-curve map of a stripped binary's executable code, one coloured trace per recovered function";
		plate.replaceChildren(img);
		return;
	}
	svg.classList.add("fig-svg");
	plate.replaceChildren(svg);
	const traces = [...svg.querySelectorAll<SVGPolylineElement>("polyline")];

	// Trace the curve like a pen, in address order. Pointing at the map while
	// it's still drawing finishes the drawing at once rather than fighting it.
	const drawing: Animation[] = [];
	if (!reduceMotion) {
		const lens = traces.map((t) => (t.getAttribute("points") ?? "").trim().split(/\s+/).length);
		const total = lens.reduce((a, b) => a + b, 0);
		const T = 2400;
		let acc = 0;
		traces.forEach((t, i) => {
			t.setAttribute("pathLength", "1");
			drawing.push(t.animate(
				[{ strokeDasharray: "0 1", opacity: 0 }, { opacity: 1, offset: 0.001 }, { strokeDasharray: "1 0", opacity: 1 }],
				{ duration: Math.max(12, (lens[i] / total) * T), delay: 150 + (acc / total) * T, easing: "linear", fill: "backwards" },
			));
			acc += lens[i];
		});
	}
	svg.addEventListener("pointerenter", () => { for (const a of drawing) a.finish(); }, { once: true });

	// Hovering lifts one trace out of the map with an outline; the rest of the
	// map stays exactly as it is. Pointing at the gaps between traces keeps the
	// current one, so moving across the map doesn't flicker.
	const overlay = document.createElementNS(SVGNS, "g");
	overlay.setAttribute("class", "fig-overlay");
	const halo = document.createElementNS(SVGNS, "polyline");
	halo.setAttribute("class", "fig-halo");
	const lift = document.createElementNS(SVGNS, "polyline");
	lift.setAttribute("class", "fig-lift");
	overlay.append(halo, lift);
	svg.append(overlay);

	const idle = readout.textContent ?? "";
	let hot: SVGPolylineElement | null = null;
	svg.addEventListener("pointerover", (e) => {
		const t = e.target;
		if (!(t instanceof SVGPolylineElement) || !t.dataset.f || t === hot) return;
		hot = t;
		const points = t.getAttribute("points") ?? "";
		halo.setAttribute("points", points);
		lift.setAttribute("points", points);
		lift.setAttribute("stroke", t.getAttribute("stroke") ?? "#fff");
		overlay.classList.add("on");
		const [name, start, end, size, kind] = t.dataset.f.split("|");
		readout.textContent =
			kind === "u" ? `past the end of the code · ${size} empty cells`
			: kind === "g" ? `gap  ${start}–${end}  ${Number(size).toLocaleString("en-GB")} bytes · no unwind info`
			: `${name}  ${start}–${end}  ${Number(size).toLocaleString("en-GB")} bytes${kind === "l" ? " · has landing pads" : ""}`;
	});
	svg.addEventListener("pointerleave", () => {
		hot = null;
		overlay.classList.remove("on");
		readout.textContent = idle;
	});
}

// ----------------------------------------------- section table + offsets
const SECTIONS = [...document.querySelectorAll<HTMLElement>("[data-sec]")];

function layoutOffsets() {
	for (const s of SECTIONS) {
		const top = s.getBoundingClientRect().top + window.scrollY;
		const size = s.offsetHeight;
		const addr = s.querySelector(".gutter .addr");
		if (addr) addr.textContent = hex(top);
		const sz = s.querySelector(".gutter .size");
		if (sz) sz.textContent = hex(size, 4);
		const row = document.querySelector(`.shdr tr[data-for="${s.id}"]`);
		if (row) {
			row.querySelector(".off")!.textContent = hex(top);
			row.querySelector(".size")!.textContent = hex(size, 4);
		}
	}
}

function initToc() {
	for (const row of document.querySelectorAll<HTMLTableRowElement>(".shdr tbody tr")) {
		row.addEventListener("click", (e) => {
			if ((e.target as Element).closest("a")) return;
			row.querySelector("a")?.click();
		});
	}
}

// ------------------------------------------- minimap: this page, as a curve
const SIDE = 16;
const CELLS = SIDE * SIDE;
const CURVE = Array.from({ length: CELLS }, (_, d) => hilbert(SIDE, d).map((v) => v * 8 + 4) as [number, number]);
const pts = (from: number, to: number) => CURVE.slice(from, to + 1).map(([x, y]) => `${x},${y}`).join(" ");
const SVGNS = "http://www.w3.org/2000/svg";

function initMinimap() {
	const box = $("minimap");
	const svg = $("mm") as unknown as SVGSVGElement | null;
	const secLabel = $("mm-sec");
	const offLabel = $("mm-off");
	if (!box || !svg || !secLabel || !offLabel) return;

	let ranges: { el: HTMLElement; top: number; from: number; to: number; dim: SVGPolylineElement; lit: SVGPolylineElement }[] = [];
	const cursor = document.createElementNS(SVGNS, "circle");
	cursor.setAttribute("r", "3.6");
	cursor.setAttribute("class", "mm-cursor");
	const root = document.documentElement;

	const build = () => {
		const docH = root.scrollHeight;
		svg.replaceChildren();
		ranges = SECTIONS.map((el, i) => {
			const top = el.getBoundingClientRect().top + window.scrollY;
			const from = Math.min(CELLS - 1, Math.floor((top / docH) * CELLS));
			const next = SECTIONS[i + 1];
			const to = next ? Math.min(CELLS - 1, Math.floor(((next.getBoundingClientRect().top + window.scrollY) / docH) * CELLS)) : CELLS - 1;
			const dim = document.createElementNS(SVGNS, "polyline");
			dim.setAttribute("points", pts(from, to));
			dim.setAttribute("class", `mm-dim s${i}`);
			const lit = document.createElementNS(SVGNS, "polyline");
			lit.setAttribute("class", `mm-lit s${i}`);
			svg.append(dim, lit);
			return { el, top, from, to, dim, lit };
		});
		svg.append(cursor);
		update();
	};

	const update = () => {
		const docH = root.scrollHeight;
		const mid = window.scrollY + window.innerHeight / 2;
		const at = Math.min(CELLS - 1, Math.max(0, Math.floor((mid / docH) * CELLS)));
		for (const r of ranges) {
			if (at > r.from) r.lit.setAttribute("points", pts(r.from, Math.min(at, r.to)));
			else r.lit.removeAttribute("points");
		}
		// The section under the middle of the viewport (the last one once the page bottoms out)
		// sets the page's accent to its colour on the map.
		const atBottom = window.scrollY + window.innerHeight >= docH - 4;
		let zone = 0;
		ranges.forEach((r, i) => { if (r.top <= mid) zone = i; });
		if (atBottom) zone = ranges.length - 1;
		if (root.dataset.zone !== String(zone)) root.dataset.zone = String(zone);

		const [x, y] = CURVE[at];
		cursor.setAttribute("cx", String(x));
		cursor.setAttribute("cy", String(y));
		if (ranges[zone]) secLabel.textContent = ranges[zone].el.dataset.sec ?? "";
		offLabel.textContent = hex(window.scrollY);
		box.classList.toggle("on", window.scrollY > window.innerHeight * 0.6);
	};

	svg.addEventListener("click", (e) => {
		const r = svg.getBoundingClientRect();
		const x = ((e.clientX - r.left) / r.width) * 128;
		const y = ((e.clientY - r.top) / r.height) * 128;
		let best = 0;
		let bestD = Infinity;
		CURVE.forEach(([cx, cy], i) => {
			const d = (cx - x) ** 2 + (cy - y) ** 2;
			if (d < bestD) { bestD = d; best = i; }
		});
		const docH = document.documentElement.scrollHeight;
		window.scrollTo({ top: (best / CELLS) * docH - window.innerHeight / 2, behavior: reduceMotion ? "auto" : "smooth" });
	});

	let queued = false;
	window.addEventListener("scroll", () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => { queued = false; update(); });
	}, { passive: true });
	return build;
}

// -------------------------------------------------------- projects (live)
const FEATURED = "unwind-map";
const ORDER = ["pe-walker", "pe-diff", "rtti-dump", "vtable-dump", "pattern-scan"];
const SUMMARY: Record<string, string> = {
	"pe-walker": "Inspect any PE file",
	"pe-diff": "Structural diff of two builds",
	"rtti-dump": "Class hierarchies from MSVC RTTI",
	"vtable-dump": "Vtables and the code in each slot",
	"pattern-scan": "IDA-style signature scanning",
};
const HIGHLIGHTS: Record<string, string> = {
	"pe-walker": "Headers, sections, imports and exports of any PE file, analyzed on Windows, Linux or macOS.",
	"pe-diff": "Shows what changed between two builds and exits 1 on drift, so it can gate a CI pipeline.",
	"rtti-dump": "Rebuilds inheritance trees from stripped MSVC binaries and emits Mermaid class diagrams.",
	"vtable-dump": "Finds every vtable through its RTTI back-reference and lists the code in each slot.",
	"pattern-scan": "A single header about 11× faster than a byte-by-byte scan, plus the patscan CLI.",
};
const toolClass = (name: string) => `tc-${/^[a-z0-9-]+$/.test(name) ? name : "other"}`;

function renderFeature(repo: Repo | undefined) {
	const meta = $("feature-meta");
	if (!repo || !meta) return;
	const desc = $("feature-desc");
	if (desc && repo.description) desc.textContent = repo.description;
	const latest = repo.releases[0];
	meta.replaceChildren(
		latest ? h("a", { href: latest.url }, `${latest.tag} · ${day(latest.date)}`) : h("span", {}, "No tagged release yet"),
		h("span", {}, `updated ${ago(repo.pushed)}`),
	);
	if (repo.stars > 0) meta.append(h("span", {}, `★ ${repo.stars}`));
}

function panel(repo: Repo): Child[] {
	const latest = repo.releases[0];
	const out = OUTPUTS[repo.name];
	return [
		h("header", { class: "kp-head" },
			h("h4", {}, h("i", { class: `sq ${toolClass(repo.name)}`, "aria-hidden": "true" }), repo.name),
			h("p", { class: "kp-meta" },
				repo.language ? h("span", {}, repo.language) : null,
				latest ? h("a", { href: latest.url }, `${latest.tag} · ${day(latest.date)}`) : h("span", {}, "no release yet"),
				h("span", {}, `updated ${ago(repo.pushed)}`),
				repo.stars > 0 ? h("span", {}, `★ ${repo.stars}`) : null,
			),
		),
		h("p", { class: "kp-desc" }, repo.description),
		HIGHLIGHTS[repo.name] ? h("p", { class: "kp-hl" }, HIGHLIGHTS[repo.name]) : null,
		out ? h("div", { class: "crop" }, h("pre", { class: "plate out", tabindex: "0", "aria-label": `${repo.name} output` }, listing(out))) : null,
		h("footer", { class: "kp-foot" },
			repo.topics.length ? h("ul", { class: "topics" }, ...repo.topics.slice(0, 5).map((t) => h("li", {}, t))) : null,
			h("a", { class: "btn", href: repo.url }, "Source ", h("span", { "aria-hidden": "true" }, "↗")),
		),
	];
}

function renderKit(repos: Repo[]) {
	const list = $("kit-list");
	const pane = $("kit-panel");
	if (!list || !pane) return;
	const sub = $("kit-sub");
	if (sub && !repos.every((r) => r.language === "C++")) sub.textContent = "More tools, newest first.";

	const tabs = repos.map((repo, i) => {
		const latest = repo.releases[0];
		return h("button", { class: `kit-row ${toolClass(repo.name)}`, type: "button", role: "tab", id: `kit-tab-${i}`, "aria-controls": "kit-panel", "aria-selected": "false", tabindex: "-1" },
			h("span", { class: "kr-idx" }, String(i + 1).padStart(2, "0")),
			h("span", { class: "kr-name" }, repo.name),
			h("span", { class: "kr-sum" }, SUMMARY[repo.name] ?? repo.description),
			h("span", { class: "kr-ver" }, latest ? latest.tag : "–"),
		);
	});
	let selected = -1;
	const select = (i: number, focus = false) => {
		if (i === selected) return;
		selected = i;
		tabs.forEach((t, j) => {
			t.setAttribute("aria-selected", String(j === i));
			t.setAttribute("tabindex", j === i ? "0" : "-1");
		});
		pane.setAttribute("aria-labelledby", tabs[i].id);
		pane.replaceChildren(...panel(repos[i]).filter((c): c is Node | string => Boolean(c)));
		if (focus) tabs[i].focus();
	};
	tabs.forEach((t, i) => {
		t.addEventListener("click", () => select(i));
		t.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") select(i); });
		t.addEventListener("keydown", (e) => {
			const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
			if (step) { e.preventDefault(); select((i + step + tabs.length) % tabs.length, true); }
		});
	});
	list.replaceChildren(...tabs);
	if (tabs.length) select(0);
}

function renderReleases(repos: Repo[]) {
	const releases = repos.flatMap((r) => r.releases.map((rel) => ({ repo: r.name, ...rel })))
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, 14);
	const days = new Map<string, typeof releases>();
	for (const rel of releases) days.set(day(rel.date), [...(days.get(day(rel.date)) ?? []), rel]);
	$("timeline")?.replaceChildren(...[...days].map(([d, rels]) =>
		h("li", { class: "vday" },
			h("time", { datetime: d }, longDay(rels[0].date)),
			h("ol", {}, ...rels.map((rel) =>
				h("li", { class: toolClass(rel.repo) },
					h("a", { href: rel.url },
						h("i", { class: "sq", "aria-hidden": "true" }),
						h("span", { class: "v-repo" }, rel.repo),
						h("span", { class: "v-tag" }, rel.tag),
					),
					rel.summary ? h("p", {}, rel.summary) : null,
				))),
		)));
	return releases;
}

function renderProjects(data: GitHubData) {
	const featured = data.repos.find((r) => r.name === FEATURED);
	const rank = (r: Repo) => (ORDER.includes(r.name) ? ORDER.indexOf(r.name) : ORDER.length);
	const rest = data.repos.filter((r) => r.name !== FEATURED).sort((a, b) => rank(a) - rank(b) || b.pushed.localeCompare(a.pushed));
	renderFeature(featured);
	renderKit(rest);
	renderReleases(data.repos);

	const all = data.repos.flatMap((r) => r.releases.map((rel) => ({ repo: r.name, ...rel }))).sort((a, b) => b.date.localeCompare(a.date));
	const set = (id: string, text: string) => { const el = $(id); if (el) el.textContent = text; };
	set("toc-tools", String(data.repos.length));
	set("toc-releases", String(all.length));
	const latest = $("latest");
	if (latest && all[0]) {
		latest.replaceChildren(h("i", { "aria-hidden": "true" }), h("span", {}, "Latest release: ", h("a", { href: all[0].url }, `${all[0].repo} ${all[0].tag}`), `, ${ago(all[0].date)}`));
		latest.hidden = false;
	}
	set("source-note", data.source === "live"
		? `Live from the GitHub API · fetched ${ago(data.fetchedAt)}`
		: `GitHub snapshot from ${day(data.fetchedAt)} (the live API is busy right now)`);
}

async function loadProjects() {
	try {
		const res = await fetch("/api/github");
		if (!res.ok) throw new Error(String(res.status));
		renderProjects((await res.json()) as GitHubData);
	} catch {
		const note = $("source-note");
		if (note) note.textContent = "Couldn't reach GitHub just now; every tool is at github.com/sheranton.";
	}
}

// ------------------------------------------------------------ reveal on scroll
function reveal() {
	if (reduceMotion || !("IntersectionObserver" in window)) return;
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
	}, { rootMargin: "0px 0px -8% 0px" });
	document.querySelectorAll(".sec:not(.hero) .sec-main > *").forEach((el) => { el.classList.add("rv"); io.observe(el); });
}

// ------------------------------------------------------------------- boot
$("out-unwind-map")?.replaceChildren(listing(OUTPUTS["unwind-map"]));
$("year")!.textContent = String(new Date().getFullYear());
$("build")!.textContent = __BUILD_DATE__;
initTheme();
decodeName();
initToc();
reveal();
const rebuildMinimap = initMinimap();
let pending = false;
const relayout = () => {
	if (pending) return;
	pending = true;
	requestAnimationFrame(() => { pending = false; layoutOffsets(); rebuildMinimap?.(); });
};
layoutOffsets();
rebuildMinimap?.();
new ResizeObserver(relayout).observe(document.body);
document.fonts?.ready.then(relayout);
initFigure();
loadProjects();
