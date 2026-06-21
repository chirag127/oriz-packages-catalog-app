// src/content/config.ts
// ─────────────────────
// Starlight's docs collection — we keep it standard. Per-package
// metadata travels in each generated markdown file's frontmatter
// (see src/lib/discover-packages.ts → emitMarkdown).
import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ schema: docsSchema() }),
};
