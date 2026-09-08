/** Ukázkový obrázek jako SVG — gradient s popiskem, žádná fotografie. */
export function ukazkovyObrazekSvg(popisek: string, barva: string, w = 1080, h = 1350): string {
  const esc = popisek.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${barva}"/>
      <stop offset="1" stop-color="#16211c"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <circle cx="${w * 0.7}" cy="${h * 0.35}" r="${w * 0.22}" fill="#ffffff" fill-opacity="0.08"/>
  <text x="${w / 2}" y="${h * 0.55}" font-family="Archivo, Arial, sans-serif" font-size="48" fill="#f6f2e9" text-anchor="middle">${esc}</text>
  <text x="${w / 2}" y="${h * 0.55 + 70}" font-family="Archivo, Arial, sans-serif" font-size="30" fill="#f6f2e9" fill-opacity="0.7" text-anchor="middle">demo obrázek – nahraďte skutečnou fotografií</text>
</svg>`;
}
