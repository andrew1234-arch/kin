import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Rebuilt at most hourly so new launches appear without a redeploy.
export const revalidate = 3600;

const STATIC: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.9, changeFrequency: "monthly" },
  { path: "/launch/new", priority: 0.8, changeFrequency: "monthly" },
  { path: "/scan", priority: 0.9, changeFrequency: "weekly" },
  { path: "/flow", priority: 0.9, changeFrequency: "daily" },
  { path: "/launch", priority: 0.8, changeFrequency: "daily" },
  { path: "/replay", priority: 0.7, changeFrequency: "weekly" },
];

/** Launch slugs from the engine API; an unreachable API just leaves them out. */
async function launchSlugs(): Promise<string[]> {
  const api = process.env.NEXT_PUBLIC_KIN_API;
  if (!api) return [];
  try {
    const res = await fetch(`${api.replace(/\/$/, "")}/launches`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const list = (await res.json()) as { slug?: unknown }[];
    return list.map((l) => l.slug).filter((s): s is string => typeof s === "string" && /^[a-z0-9-]+$/i.test(s));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const slugs = await launchSlugs();
  return [
    ...STATIC.map((s) => ({ url: `${SITE_URL}${s.path}`, lastModified: now, changeFrequency: s.changeFrequency, priority: s.priority })),
    ...slugs.flatMap((slug) => [
      { url: `${SITE_URL}/launch/${slug}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.6 },
      { url: `${SITE_URL}/receipt/${slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.5 },
    ]),
  ];
}
