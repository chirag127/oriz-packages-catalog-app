// src/lib/groups.ts
// ─────────────────
// 5 sidebar groups for the Oriz Packages catalog. Group membership is
// keyword-based on the short package name (the bit after `@chirag127/`,
// minus the `-npm-pkg` GitHub-only suffix).
//
// To map a NEW package discovered at build time, run it through
// `assignGroup(shortName)`. The first matching rule wins.

export type GroupSlug =
  | "astro-foundation"
  | "ui-widgets"
  | "data-auth"
  | "distribution"
  | "testing";

export interface SidebarGroup {
  slug: GroupSlug;
  label: string;
  /** Description shown on the catalog homepage card for this group. */
  description: string;
  /** Canonical package short-names assigned to this group (hand-curated seed). */
  members: readonly string[];
}

export const sidebarGroups: readonly SidebarGroup[] = [
  {
    slug: "astro-foundation",
    label: "Astro foundation",
    description:
      "Core building blocks every oriz app depends on — the shell, chrome, config loader, and content pipeline.",
    members: ["astro-shell", "astro-chrome", "astro-config", "astro-content"],
  },
  {
    slug: "ui-widgets",
    label: "UI & widgets",
    description:
      "User-facing components — tools panels, icons, forms, MDX rendering, TOC, comments, share, keyboard, feedback, affiliate, newsletter, search, PWA.",
    members: [
      "astro-tools",
      "astro-widgets",
      "astro-icons",
      "astro-forms",
      "astro-mdx",
      "astro-toc",
      "astro-comments",
      "astro-share",
      "astro-keyboard",
      "astro-feedback",
      "astro-affiliate",
      "astro-newsletter",
      "astro-search",
      "astro-pwa",
    ],
  },
  {
    slug: "data-auth",
    label: "Data & auth",
    description:
      "Data layer, billing, and the cross-surface auth-core set (CLI, web extension, VS Code).",
    members: [
      "astro-data",
      "astro-billing",
      "auth-core",
      "auth-wxt",
      "auth-vsc",
      "auth-cli",
    ],
  },
  {
    slug: "distribution",
    label: "Distribution",
    description:
      "Get content and binaries out into the world — cross-post engine and distribution targets.",
    members: ["astro-distribute", "omni-publish"],
  },
  {
    slug: "testing",
    label: "Testing",
    description: "Test utilities and the AI-assisted test harness.",
    members: ["astro-test-utils", "astro-ai"],
  },
] as const;

/**
 * Assign a package short-name to one of the 5 groups via keyword rules.
 * Used for packages that aren't in the hand-curated `members` lists
 * above (i.e. packages added to chirag127/* AFTER this catalog was
 * last edited). First-match-wins.
 */
export function assignGroup(shortName: string): GroupSlug {
  // 1. Exact-match against hand-curated members first.
  for (const group of sidebarGroups) {
    if (group.members.includes(shortName)) return group.slug;
  }

  // 2. Keyword fallback rules — order matters.
  const n = shortName.toLowerCase();

  if (n.startsWith("auth-")) return "data-auth";
  if (n.includes("test")) return "testing";
  if (n.includes("publish") || n.includes("distribute")) return "distribution";
  if (n.includes("data") || n.includes("billing")) return "data-auth";
  if (
    n === "astro-shell" ||
    n === "astro-chrome" ||
    n === "astro-config" ||
    n === "astro-content"
  ) {
    return "astro-foundation";
  }

  // 3. Default bucket — most new astro-* widgets land here.
  return "ui-widgets";
}

/**
 * Look up a group definition by slug. Returns undefined if the slug
 * is unknown.
 */
export function getGroup(slug: GroupSlug): SidebarGroup | undefined {
  return sidebarGroups.find((g) => g.slug === slug);
}
