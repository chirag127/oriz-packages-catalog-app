// src/lib/discover-packages.ts
// ────────────────────────────
// Build-time auto-discovery of @chirag127/*-npm-pkg packages.
//
// Pipeline per build:
//   1. List public, non-archived repos for chirag127 matching *-npm-pkg.
//   2. For each repo:
//      a. Fetch README from raw.githubusercontent.com/<repo>/main/README.md.
//      b. Fetch npm metadata from registry.npmjs.org/@chirag127/<short>.
//      c. Fetch GitHub metadata via api.github.com/repos/chirag127/<repo>.
//      d. Fetch bundle size from bundlephobia.com/api/size?package=...
//   3. Write a Starlight markdown page per package into
//      src/content/docs/packages/<group-slug>/<short>.md with the README
//      as the body and metadata in the frontmatter.
//   4. Sister-packages are computed from the group map and linked at the
//      bottom of each page.
//
// Caching: hourly cache in `.cache/discover-packages.json` so re-runs
// inside the same hour skip the network entirely. Per-API failures fall
// back to the last cached value, then to a sensible stub. The build
// never hard-fails on a transient API outage.
//
// USAGE
// ─────
//   # As a prebuild step (preferred — Astro picks up the generated
//   # markdown via Starlight's autogenerate sidebar):
//   tsx src/lib/discover-packages.ts
//   astro build
//
// ENV
// ───
//   GITHUB_TOKEN  Optional. Raises GitHub API rate limit from 60/h to
//                 5000/h. Set in CI; not required for local builds (a
//                 cold catalog has ~30 repos so unauthed works).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assignGroup, sidebarGroups } from "./groups.ts";
import type { GroupSlug } from "./groups.ts";

// ── Constants ───────────────────────────────────────────────────────
const REPO_OWNER = "chirag127";
const REPO_PATTERN = /-npm-pkg$/;
const NPM_SCOPE = "@chirag127";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CACHE_FILE = join(ROOT, ".cache", "discover-packages.json");
const OUT_DIR = join(ROOT, "src", "content", "docs", "packages");

// ── Types ───────────────────────────────────────────────────────────
export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at: string;
  archived: boolean;
  private: boolean;
  html_url: string;
}

export interface NpmMetadata {
  version: string;
  lastPublish: string;
  license: string;
  dependencyCount: number;
  weeklyDownloads: number;
  unpackedSize: number | null;
}

export interface BundleSize {
  size: number;
  gzip: number;
}

export interface DiscoveredPackage {
  /** Repo slug, e.g. `astro-shell-npm-pkg`. */
  repo: string;
  /** Short name (npm + sidebar), e.g. `astro-shell`. */
  shortName: string;
  /** Group assignment. */
  group: GroupSlug;
  /** Repo description (from GitHub). */
  tagline: string;
  /** Fetched README markdown body. */
  readme: string;
  github: {
    stars: number;
    openIssues: number;
    lastCommit: string;
    contributors: number;
    htmlUrl: string;
  };
  npm: NpmMetadata;
  bundle: BundleSize | null;
}

// ── Cache helpers ───────────────────────────────────────────────────
interface CacheShape {
  fetchedAt: number;
  packages: DiscoveredPackage[];
}

async function loadCache(): Promise<CacheShape | null> {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

async function saveCache(cache: CacheShape): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

// ── Fetch helpers (fail-soft) ───────────────────────────────────────
function ghHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "oriz-packages-catalog",
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function listRepos(): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/users/${REPO_OWNER}/repos?per_page=100&page=${page}&type=public&sort=updated`,
      { headers: ghHeaders() },
    );
    if (!res.ok) {
      console.warn(`[discover] GH list page ${page} → ${res.status}`);
      break;
    }
    const batch = (await res.json()) as GitHubRepo[];
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.filter(
    (r) => !r.private && !r.archived && REPO_PATTERN.test(r.name),
  );
}

async function fetchReadme(repo: string): Promise<string> {
  // Try `main` then `master`. Cloudflare's `raw.githubusercontent.com`
  // is unauthenticated, so no token needed.
  for (const branch of ["main", "master"]) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${repo}/${branch}/README.md`,
    );
    if (res.ok) return await res.text();
  }
  return `# ${repo}\n\n_No README found — fallback stub._`;
}

async function fetchNpm(shortName: string): Promise<NpmMetadata> {
  const pkg = `${NPM_SCOPE}/${shortName}`;
  const stub: NpmMetadata = {
    version: "0.0.0",
    lastPublish: "",
    license: "MIT",
    dependencyCount: 0,
    weeklyDownloads: 0,
    unpackedSize: null,
  };
  try {
    const meta = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
    );
    if (!meta.ok) return stub;
    const data = (await meta.json()) as {
      "dist-tags"?: { latest?: string };
      time?: Record<string, string>;
      versions?: Record<
        string,
        {
          license?: string;
          dependencies?: Record<string, string>;
          dist?: { unpackedSize?: number };
        }
      >;
    };
    const latest = data["dist-tags"]?.latest ?? "0.0.0";
    const versionMeta = data.versions?.[latest];
    const lastPublish = data.time?.[latest] ?? "";
    const depCount = Object.keys(versionMeta?.dependencies ?? {}).length;

    let weekly = 0;
    try {
      const dl = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`,
      );
      if (dl.ok) {
        const dlData = (await dl.json()) as { downloads?: number };
        weekly = dlData.downloads ?? 0;
      }
    } catch {
      /* fall through */
    }

    return {
      version: latest,
      lastPublish,
      license: versionMeta?.license ?? "MIT",
      dependencyCount: depCount,
      weeklyDownloads: weekly,
      unpackedSize: versionMeta?.dist?.unpackedSize ?? null,
    };
  } catch (err) {
    console.warn(`[discover] npm fetch failed for ${pkg}:`, err);
    return stub;
  }
}

async function fetchGitHubMeta(
  repo: GitHubRepo,
): Promise<DiscoveredPackage["github"]> {
  let contributors = 1;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${repo.name}/contributors?per_page=100&anon=true`,
      { headers: ghHeaders() },
    );
    if (res.ok) {
      const arr = (await res.json()) as unknown[];
      contributors = arr.length;
    }
  } catch {
    /* fall through */
  }
  return {
    stars: repo.stargazers_count,
    openIssues: repo.open_issues_count,
    lastCommit: repo.pushed_at,
    contributors,
    htmlUrl: repo.html_url,
  };
}

async function fetchBundleSize(shortName: string): Promise<BundleSize | null> {
  const pkg = `${NPM_SCOPE}/${shortName}`;
  try {
    const res = await fetch(
      `https://bundlephobia.com/api/size?package=${encodeURIComponent(pkg)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { size?: number; gzip?: number };
    if (data.size == null || data.gzip == null) return null;
    return { size: data.size, gzip: data.gzip };
  } catch {
    return null;
  }
}

// ── Main pipeline ───────────────────────────────────────────────────
export async function discoverAll(): Promise<DiscoveredPackage[]> {
  // Cache check.
  const cached = await loadCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    console.log(
      `[discover] cache hit — ${cached.packages.length} packages, age ${Math.round((Date.now() - cached.fetchedAt) / 60000)}m`,
    );
    return cached.packages;
  }

  const repos = await listRepos();
  console.log(`[discover] ${repos.length} matching repos`);

  const packages: DiscoveredPackage[] = [];
  for (const repo of repos) {
    const shortName = repo.name.replace(/-npm-pkg$/, "");
    const group = assignGroup(shortName);

    const [readme, npm, github, bundle] = await Promise.all([
      fetchReadme(repo.name),
      fetchNpm(shortName),
      fetchGitHubMeta(repo),
      fetchBundleSize(shortName),
    ]);

    packages.push({
      repo: repo.name,
      shortName,
      group,
      tagline: repo.description ?? "",
      readme,
      github,
      npm,
      bundle,
    });
  }

  // Best-effort merge: if a package failed entirely AND we have it in
  // cache, prefer the cached entry.
  if (cached) {
    for (const old of cached.packages) {
      if (!packages.find((p) => p.repo === old.repo)) {
        packages.push(old);
      }
    }
  }

  await saveCache({ fetchedAt: Date.now(), packages });
  return packages;
}

// ── Markdown emit ───────────────────────────────────────────────────
function sisterPackages(
  current: DiscoveredPackage,
  all: DiscoveredPackage[],
): DiscoveredPackage[] {
  return all
    .filter((p) => p.group === current.group && p.shortName !== current.shortName)
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
}

function emitMarkdown(
  pkg: DiscoveredPackage,
  sisters: DiscoveredPackage[],
): string {
  const fm = [
    "---",
    `title: "${NPM_SCOPE}/${pkg.shortName}"`,
    `description: ${JSON.stringify(pkg.tagline || `${pkg.shortName} — part of the oriz family.`)}`,
    `editUrl: false`,
    `tableOfContents: true`,
    "---",
  ].join("\n");

  const metaTable = [
    "## Package metadata",
    "",
    "| Field | Value |",
    "|---|---|",
    `| **npm version** | \`${pkg.npm.version}\` |`,
    `| **Last publish** | ${pkg.npm.lastPublish || "—"} |`,
    `| **Weekly downloads** | ${pkg.npm.weeklyDownloads.toLocaleString()} |`,
    `| **License** | ${pkg.npm.license} |`,
    `| **Dependencies** | ${pkg.npm.dependencyCount} |`,
    `| **Unpacked size** | ${pkg.npm.unpackedSize ? `${(pkg.npm.unpackedSize / 1024).toFixed(1)} KB` : "—"} |`,
    `| **Bundle (min)** | ${pkg.bundle ? `${(pkg.bundle.size / 1024).toFixed(1)} KB` : "—"} |`,
    `| **Bundle (min+gzip)** | ${pkg.bundle ? `${(pkg.bundle.gzip / 1024).toFixed(1)} KB` : "—"} |`,
    `| **GitHub stars** | ${pkg.github.stars} |`,
    `| **Open issues** | ${pkg.github.openIssues} |`,
    `| **Contributors** | ${pkg.github.contributors} |`,
    `| **Last commit** | ${pkg.github.lastCommit || "—"} |`,
    `| **Repository** | [${pkg.repo}](${pkg.github.htmlUrl}) |`,
    `| **npm** | [\`${NPM_SCOPE}/${pkg.shortName}\`](https://www.npmjs.com/package/${NPM_SCOPE}/${pkg.shortName}) |`,
    "",
  ].join("\n");

  const sisterBlock =
    sisters.length === 0
      ? ""
      : [
          "## Sister packages",
          "",
          "Other packages in the same group:",
          "",
          ...sisters.map(
            (s) =>
              `- [\`${NPM_SCOPE}/${s.shortName}\`](/packages/${s.group}/${s.shortName}/) — ${s.tagline || "(no description)"}`,
          ),
          "",
        ].join("\n");

  return [fm, "", metaTable, pkg.readme.trim(), "", sisterBlock].join("\n");
}

export async function emitAll(packages: DiscoveredPackage[]): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const group of sidebarGroups) {
    await mkdir(join(OUT_DIR, group.slug), { recursive: true });
  }
  for (const pkg of packages) {
    const sisters = sisterPackages(pkg, packages);
    const md = emitMarkdown(pkg, sisters);
    const file = join(OUT_DIR, pkg.group, `${pkg.shortName}.md`);
    await writeFile(file, md, "utf8");
  }
  console.log(`[discover] emitted ${packages.length} package pages`);
}

// ── Entry ───────────────────────────────────────────────────────────
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const packages = await discoverAll();
  await emitAll(packages);
}
