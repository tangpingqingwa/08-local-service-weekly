import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Local Service Weekly",
    short_name: "Local Service",
    description: "A transparent rolling seven-day local-service classified.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4ead0",
    theme_color: "#8b1e12",
    icons: [{ src: "/brand-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
