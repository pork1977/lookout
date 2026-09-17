import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Shared run links carry someone else's own group names and are meant
      // for whoever they were sent to, not for search results. The pages
      // also carry a noindex meta tag; this keeps crawlers from fetching
      // them in the first place.
      disallow: ["/run/", "/api/"],
    },
    sitemap: "https://lookout.vision/sitemap.xml",
  };
}
