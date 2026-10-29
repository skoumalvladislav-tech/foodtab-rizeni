import type { MetadataRoute } from 'next'

/**
 * Manifest kiosku Jiných plateb na telefonu (app/kiosek/doklady/page.tsx).
 *
 * Vlastní, ne kiosku Docházky: Android bere `start_url` z manifestu, na
 * který stránka odkazuje — se společným by ikona na ploše telefonu
 * otevřela tablet Docházky (docs/kiosek-vlastni-manifest.md). Telefon
 * se drží NA VÝŠKU; `scope` jen tahle adresa.
 */
const manifest: MetadataRoute.Manifest = {
  id: '/kiosek/doklady',
  name: 'Foodtab doklady',
  short_name: 'Doklady',
  description: 'Vyfotit účet a poslat ho do Jiných plateb pobočky. Jedna obrazovka, nic dalšího.',
  start_url: '/kiosek/doklady',
  scope: '/kiosek/doklady',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f6f5f2',
  theme_color: '#17191c',
  lang: 'cs',
  categories: ['business', 'productivity'],
  icons: [
    { src: '/kiosek-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/kiosek-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/kiosek-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'public, max-age=3600',
    },
  })
}
