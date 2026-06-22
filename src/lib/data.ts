// src/lib/data.ts — load packages.json at build time
import data from "../../data/packages.json";

export interface Pkg {
  slug: string;
  repoSlug: string;
  name: string;
  shortName: string;
  title: string;
  description: string;
  category: "astro" | "auth" | "utilities";
  install: string;
  npmUrl: string;
  githubUrl: string;
  bundleSize: string;
  stars: number;
  lastPublish: string;
}

export interface Catalog {
  generatedAt: string;
  count: number;
  categories: { astro: number; auth: number; utilities: number };
  packages: Pkg[];
}

export const catalog = data as unknown as Catalog;

export function getCategoryLabel(c: string): string {
  if (c === "astro") return "Astro";
  if (c === "auth") return "Auth";
  return "Utilities";
}
