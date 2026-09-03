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
    /*
      Zkratky jsou ZRUŠENÉ, ne opravené.

      Mířily na /?modul=attendance, /?modul=tasks
      a /?modul=communication — adresování ze starého prototypu.
      Parametr modul dnes nikdo nečte: ověřeno naostro, všechny tři
      adresy skončí na témže místě jako samotné /. Zkratka, která
      vede tam, kam už vede ikona, je horší než žádná.

      Opravit se nedají: dnešní obrazovky jsou /[rozsah]/dochazka
      a spol., takže adresa potřebuje rozsah — a ten závisí na tom,
      kdo je přihlášený. Manifest to vědět nemůže a statická zkratka
      na /cerna-perla/dochazka by byla pobočka napevno v kódu
      (pravidlo 1).

      Až bude existovat adresa, která přihlášeného pošle na jeho
      docházku bez uvedení rozsahu, zkratky se sem vrátí. Do té doby
      tu nejsou schválně.
    */
  };
}
