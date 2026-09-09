import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FoodTab Marketing AI",
    short_name: "FoodTab Marketing",
    description: "Tvorba, schvalování a publikování gastro obsahu.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f2e9",
    theme_color: "#241d1a",
    lang: "cs",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
