import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Foodtab – řízení restaurací",
    short_name: "Foodtab",
    description: "Interní řízení poboček, směn, úkolů, komunikace a receptur Foodtab.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f5f1ea",
    theme_color: "#202124",
    lang: "cs",
    categories: ["business", "productivity", "food"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Moje směna", short_name: "Směna", url: "/?modul=attendance" },
      { name: "Úkoly", short_name: "Úkoly", url: "/?modul=tasks" },
      { name: "Komunikace", short_name: "Zprávy", url: "/?modul=communication" },
    ],
  };
}
