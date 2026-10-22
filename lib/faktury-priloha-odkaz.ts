/**
 * Podepsaný odkaz na přílohu faktury (soukromý kbelík faktury-prilohy) —
 * sdílí ho /api/faktury/soubor/[id] i /api/faktury/priloha/[id].
 *
 * Přímo v prohlížeči se otevře JEN PDF a obrázek. Cokoli jiného (XML,
 * ISDOC, SVG s XML prologem…) se STÁHNE: XML se skriptem v XHTML jmenném
 * prostoru by se jinak spustilo na doméně projektu Supabase — podvržená
 * stránka na důvěryhodné doméně (kontrola 19. 10.). XML přitom posílá
 * kdokoli do schránky příjmu a ze starého veřejného kbelíku se převádí
 * cokoli, co tam kdy kdo nahrál.
 *
 * Rozhoduje typ uložený v úložišti, ne přípona v cestě (soubor
 * `rucne/<uuid>.pdf` mohl být nahraný jako application/xml). Když se typ
 * zjistit nepodaří, soubor se stáhne.
 *
 * Bez `server-only` — testuje ho Node (scripts/faktury-sloupce.test.mjs).
 */

const OTEVRIT_V_PROHLIZECI = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

/** To, co z kbelíku supabase-js potřebujeme (v testu podvržené). */
export type KbelikPriloh = {
  info(cesta: string): PromiseLike<{ data: { contentType?: string | null } | null; error: unknown }>
  createSignedUrl(
    cesta: string,
    platnostS: number,
    moznosti?: { download: boolean },
  ): PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>
}

export async function podepsatPrilohu(kbelik: KbelikPriloh, cesta: string, platnostS: number): Promise<string | null> {
  let vProhlizeci = false
  try {
    const { data, error } = await kbelik.info(cesta)
    const typ = String(data?.contentType ?? '').split(';')[0].trim().toLowerCase()
    vProhlizeci = !error && OTEVRIT_V_PROHLIZECI.has(typ)
  } catch {
    vProhlizeci = false
  }
  const { data } = await kbelik.createSignedUrl(cesta, platnostS, vProhlizeci ? undefined : { download: true })
  return data?.signedUrl ?? null
}
