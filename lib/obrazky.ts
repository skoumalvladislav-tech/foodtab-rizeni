/**
 * Zmenšení fotky v prohlížeči před nahráním.
 *
 * Sdílené přílohami zpráv (vzkazy/[konverzace]/priloha-pridat.tsx)
 * a fotkami položek checklistu. Snímek z telefonu má několik MB, čtenář
 * ho otevírá přes mobilní data; delší strana 2000 px a JPEG 0,85 na
 * fotku z kuchyně bohatě stačí. Neznámý formát (HEIC) se tím zároveň
 * převede na JPEG, pokud ho prohlížeč umí přečíst.
 *
 * Jen pro prohlížeč (canvas, createImageBitmap). Když se to nepodaří
 * (starší prohlížeč), vrací null a volající pošle originál, pokud vyhovuje.
 */

export const NEJDELSI_STRANA_PX = 2000
export const KVALITA_JPEG = 0.85
/** Fotky pod tuhle velikost (a v povoleném typu) se nezmenšují — zbytečně by ztratily kvalitu. */
export const NEMENIT_DO_BAJTU = 1.5 * 1024 * 1024

/** Zmenšená JPEG kopie obrázku, nebo null, když se to prohlížeči nepodaří. */
export async function zmensitObrazek(soubor: File): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null
    const bitmapa = await createImageBitmap(soubor, { imageOrientation: 'from-image' })
    const delsi = Math.max(bitmapa.width, bitmapa.height)
    const meritko = delsi > NEJDELSI_STRANA_PX ? NEJDELSI_STRANA_PX / delsi : 1
    const sirka = Math.max(1, Math.round(bitmapa.width * meritko))
    const vyska = Math.max(1, Math.round(bitmapa.height * meritko))
    const platno = document.createElement('canvas')
    platno.width = sirka
    platno.height = vyska
    const ctx = platno.getContext('2d')
    if (!ctx) return null
    // Průhledné PNG by se v JPEG staly černými; podklad je bílý.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, sirka, vyska)
    ctx.drawImage(bitmapa, 0, 0, sirka, vyska)
    bitmapa.close?.()
    return await new Promise<Blob | null>((hotovo) => platno.toBlob(hotovo, 'image/jpeg', KVALITA_JPEG))
  } catch {
    return null
  }
}

/** Náhodné uuid — i v prohlížeči bez crypto.randomUUID (starší Safari). */
export function noveId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
