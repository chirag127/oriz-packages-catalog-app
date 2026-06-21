// astro.config.mjs — Oriz Packages catalog
// ──────────────────────────────────────────
// Starlight DEFAULT theme. Sidebar is hand-curated into 5 groups, with
// each group's `items` auto-populated from src/lib/groups.ts at build
// time. Per-package detail pages are generated into src/content/docs/
// packages/<name>.md by src/lib/discover-packages.ts (run as a prebuild
// step or via top-level await; see knowledge/runbooks for the choice).
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

import { sidebarGroups } from "./src/lib/groups.ts";

export default defineConfig({
  site: "https://packages.oriz.in",
  output: "static",
  integrations: [
    react(),
    starlight({
      title: "Oriz Packages",
      description:
        "Auto-discovery catalog of MIT-licensed @chirag127 npm packages from the oriz family.",
      logo: { src: "./src/assets/wordmark.svg", replacesTitle: true },
      social: {
        github: "https://github.com/chirag127",
      },
      customCss: ["./src/styles/custom.css"],
      // Pagefind ships with Starlight by default; no extra integration needed.
      sidebar: sidebarGroups.map((group) => ({
        label: group.label,
        // Build-time-populated. Falls back to autogenerate if the
        // discovery step hasn't run yet (e.g. fresh checkout).
        autogenerate: { directory: `packages/${group.slug}` },
      })),
    }),
  ],
});
