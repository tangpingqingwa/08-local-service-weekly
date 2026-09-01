import type { MetadataRoute } from "next";
import { CATEGORIES } from "../src/categories";
import { CITIES } from "../src/cities";

const SITE_URL = "https://localservice.lol";

export default function sitemap(): MetadataRoute.Sitemap {
  const lanes = CITIES.filter((city) => city.public).flatMap((city) =>
    CATEGORIES.map((category) => ({
      url: `${SITE_URL}/c/${city.slug}/${category.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  );
  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    ...lanes,
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/rules`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
