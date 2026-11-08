import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Embeds are iframe widgets for other sites; the full receipt page is the one to index.
    rules: { userAgent: "*", allow: "/", disallow: "/embed/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
