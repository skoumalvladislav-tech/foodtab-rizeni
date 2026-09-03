import type { MetadataRoute } from 'next'

/**
 * Manifest jen pro kiosek.
 *
 * Nález: docs/kiosek-vlastni-manifest.md.
 *
 * ---------------------------------------------------------------------
 * PROČ DRUHÝ MANIFEST
 *
 * Šéfík si na tabletu za barem přidal kiosek na plochu a ikona otevřela
 * PŘIHLAŠOVACÍ OBRAZOVKU. Android se při „Přidat na plochu“ neřídí
 * adresou, na které stojíš, ale `start_url` z manifestu — a společný
 * manifest má `start_url: "/"`. Takže ať se instaluje odkudkoli, ikona
 * vždycky skončí na kořeni aplikace.
 *
 * Odsud se to řešit nedá: `start_url` je jeden na manifest. Kiosek
 * proto potřebuje vlastní.
 *
 * ---------------------------------------------------------------------
 * PROČ JE TO ROUTE, A NE `manifest.ts`
 *
 * Zvláštní soubor `manifest.ts` funguje jen v korenu `app/` a je jeden.
 * Druhý manifest se tedy servíruje jako běžná adresa — název složky
 * dělá cestu `/kiosek.webmanifest`.
 *
 * ---------------------------------------------------------------------
 * ROZDÍLY PROTI SPOLEČNÉMU MANIFESTU, A PROČ
 *
 *   start_url, scope   `/kiosek` — jinak ikona vede na přihlášení
 *   display            `fullscreen`, ne `standalone`: tablet stojí na
 *                      baru celý den, adresní řádek tam nemá co dělat
 *                      a bez něj se z kiosku hůř odchází jinam
 *   orientation        `landscape` — viz komentář u té položky
 *   name, icons        jiné, aby se ty dvě ikony na téže ploše
 *                      nespletly (viz scripts/kiosek-ikona.mjs)
 *   shortcuts          žádné; kiosek umí jednu věc
 */

const manifest: MetadataRoute.Manifest = {
  /*
    Vlastní `id`. Bez něj se totožnost aplikace odvozuje ze `start_url`
    a lišila by se i tak — ale s ním je to řečené a nezmění se, kdyby
    se někdy `start_url` upravil.
  */
  id: '/kiosek',
  name: 'Foodtab kiosek',
  short_name: 'Kiosek',
  description:
    'Píchačka na provozovně: měnící se QR kód a PIN. Jedna obrazovka, nic dalšího.',
  start_url: '/kiosek',
  scope: '/kiosek',
  display: 'fullscreen',

  /*
    Na šířku. Zadání nechává na výběr „volnou nebo na šířku“ a tablet
    za barem stojí na šířku — volná orientace by u tabletu se zamčeným
    otáčením skončila portrétem, tedy tam, odkud se to řeší.

    Kdyby někdo kiosek postavil na výšku, mění se tenhle jeden řádek.
  */
  orientation: 'landscape',

  /*
    Podklad úvodní obrazovky je `--paper`, tedy totéž, co má kiosek.
    Jinak mezi splashem a obrazovkou blikne jiná barva.
  */
  background_color: '#f6f2e9',
  theme_color: '#16211c',
  lang: 'cs',
  categories: ['business', 'productivity'],
  icons: [
    {
      src: '/kiosek-icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/kiosek-icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    /*
      Maskovatelná zvlášť, na celou plochu bez zakulacení. Android si ji
      obřízne do svého tvaru — kdyby měla průhledné rohy, zbyla by
      dlaždice s uhryzanými kraji.
    */
    {
      src: '/kiosek-icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
}

/*
  Statické: obsah se nemění a nemá cenu ho počítat při každém dotazu.
  Typ `application/manifest+json` je ten, který norma žádá; Chrome
  přijme i `application/json`, ale spoléhat na to nemá smysl.
*/
export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'public, max-age=3600',
    },
  })
}
