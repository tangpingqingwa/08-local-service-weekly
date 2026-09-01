import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/checkout/", "/return", "/go/", "/e/"],
    },
    sitemap: "https://localservice.lol/sitemap.xml",
    host: "https://localservice.lol",
  };
}
