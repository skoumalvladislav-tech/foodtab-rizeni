import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        /*
          Moje směny se sloučily do Docházky. Adresa musí dál fungovat:
          lidé ji mají v záložkách a je na rozeslaném QR kódu. Řeší se
          to tady, ne stránkou s přesměrováním — takhle odpoví server
          rovnou, bez vykreslování a bez načítání dat.

          Trvalé (308) proto, že obrazovka se nevrátí. Prohlížeč si to
          zapamatuje, takže QR kód nemusí sahat na server pokaždé.
        */
        source: "/:rozsah/moje-smeny",
        destination: "/:rozsah/dochazka",
        permanent: true,
      },
      /*
        Zálohy se 24. 9. 2026 přestěhovaly do Docházky jako záložka
        (zadání majitele: „sloučit kartu zálohy do karty docházka“).
        Starou adresu mají lidé v záložkách prohlížeče; parametry
        (?chyba=, ?ulozeno=) Next při přesměrování přenáší sám.

        Jen tahle jedna cesta — pod /zalohy žádné podstránky nikdy
        nebyly, zástupný znak by se tvářil, že vedou někam.
      */
      {
        source: "/:rozsah/zalohy",
        destination: "/:rozsah/dochazka/zalohy",
        permanent: true,
      },
      /*
        Moje údaje se odstěhovaly zpod rozsahu ven: osobní údaje patří
        člověku, ne provozovně, a kdo čeká na přidělení oprávnění, žádný
        platný rozsah nemá — na `/cerna-perla/moje-udaje` by se tedy
        nedostal. Viz docs/odpovedi-pozvanky-2026-09-01.md, oddíl 2.

        Vyjmenované cesty jsou dvě, ne jedna se zástupným znakem:
        `/:rozsah/moje-udaje/:cesta*` by chytalo i adresy, které nikdy
        neexistovaly, a tvářilo se, že vedou někam.
      */
      {
        source: "/:rozsah/moje-udaje",
        destination: "/moje-udaje",
        permanent: true,
      },
      {
        source: "/:rozsah/moje-udaje/export",
        destination: "/moje-udaje/export",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
