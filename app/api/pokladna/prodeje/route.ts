import { NextResponse } from 'next/server'

import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'
import { rozsifrovat } from '@/lib/integrace-klice'
import { overitDavku, rozebratKlicPrijmu } from '@/lib/pokladna-prijem-api'
import { provozniDen } from '@/lib/pokladna-cas'

/**
 * Příjmové API Foodtabu pro pokladny — `POST /api/pokladna/prodeje`.
 *
 * Pro pokladnu, kterou appka neumí napojit sama: pokladna (nebo n8n,
 * Make…) pošle denní prodeje s klíčem, který appka vydala v Integracích
 * → Pokladní systémy → „Jiná pokladna". Popis pro integrátora:
 * `docs/pokladna-api.md`.
 *
 * Přihlášený člověk tu není — klíč nahrazuje přihlášení, proto
 * `service_role` (výjimka zapsaná v `lib/supabase/uloha.ts`). Klíč
 * určuje připojení, připojení určuje firmu a pobočku; z těla se bere
 * jen obsah prodeje, nikdy kam ho zapsat.
 *
 * Odpovědi bez detailů o tom, PROČ klíč neplatí (neexistuje / odpojené
 * / vyměněný) — kdo hádá klíče, nemá se dozvědět, které id existuje.
 */

export const dynamic = 'force-dynamic'

const MAX_BAJTU = 2_000_000

function chyba(status: number, kod: string, zprava: string): NextResponse {
  return NextResponse.json({ ok: false, chyba: kod, zprava }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const klic = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7).trim() : ''
  const rozbor = klic ? rozebratKlicPrijmu(klic) : null
  const neplatnyKlic = () => chyba(401, 'neplatny_klic', 'Klíč chybí nebo neplatí (hlavička Authorization: Bearer ftpos_…).')
  if (!rozbor) return neplatnyKlic()

  const supabase = klientUlohy()
  if (!supabase) return chyba(503, 'nenastaveno', 'Příjem prodejů není na serveru nastavený.')

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, branch_id')
    .eq('id', rozbor.pripojeniId)
    .eq('oblast', 'pokladna')
    .eq('poskytovatel', 'obecne')
    .is('odpojeno_kdy', null)
    .maybeSingle()
  if (!pripojeni) return neplatnyKlic()

  const { data: tajemstvi } = await supabase
    .from('integrace_tajemstvi')
    .select('sifra')
    .eq('pripojeni_id', pripojeni.id)
    .maybeSingle()

  let ulozenyKlic: string | undefined
  try {
    ulozenyKlic = tajemstvi ? rozsifrovat(tajemstvi.sifra).klic : undefined
  } catch {
    ulozenyKlic = undefined
  }
  if (!tajemstviSedi(klic, ulozenyKlic)) return neplatnyKlic()
  if (!pripojeni.branch_id) return chyba(409, 'bez_pobocky', 'Připojení nemá pobočku — založte ho v Integracích znovu.')

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BAJTU) {
    return chyba(413, 'prilis_velke', 'Dávka je větší než 2 MB — pošlete ji po částech (po dnech).')
  }
  const text = await request.text()
  if (text.length > MAX_BAJTU) return chyba(413, 'prilis_velke', 'Dávka je větší než 2 MB — pošlete ji po částech (po dnech).')

  let telo: unknown
  try {
    telo = JSON.parse(text)
  } catch {
    return chyba(400, 'neni_json', 'Tělo požadavku není platný JSON.')
  }

  const { data: pobocka } = await supabase
    .from('branches')
    .select('timezone, day_starts_at')
    .eq('id', pripojeni.branch_id)
    .maybeSingle()
  const dnes = provozniDen(Date.now(), (pobocka?.day_starts_at as string | null) || '05:00', (pobocka?.timezone as string | null) || 'Europe/Prague')

  const davka = overitDavku(telo, dnes)
  if (davka.stav === 'chyba') {
    // Klíč sedí — kdo spravuje napojení, má v Integracích vidět, proč pokladna nic nepřidala.
    await supabase.from('integrace_pripojeni').update({ posledni_chyba: `Poslední dávka odmítnuta: ${davka.duvod}` }).eq('id', pripojeni.id)
    return chyba(422, 'neplatna_data', davka.duvod)
  }

  const { data: pocet, error } = await supabase.rpc('pokladna_nahradit_prodeje', {
    p_pripojeni: pripojeni.id,
    p_branch: pripojeni.branch_id,
    p_dny: davka.dny,
    p_radky: davka.radky.map((r) => ({ datum: r.datum, produkt_nazev: r.produktNazev, mnozstvi: r.mnozstvi, trzba_haleru: r.trzbaHaleru })),
  })
  if (error) return chyba(500, 'zapis_selhal', 'Prodeje se nepodařilo zapsat — zkuste to znovu.')

  const ted = new Date().toISOString()
  await supabase.from('integrace_pripojeni').update({
    stav: 'pripojeno',
    posledni_sync_kdy: ted,
    posledni_sync_pocet_radku: (pocet as number | null) ?? 0,
    posledni_test_kdy: ted,
    posledni_test_ok: true,
    posledni_chyba: null,
  }).eq('id', pripojeni.id)

  return NextResponse.json({ ok: true, dny: davka.dny, zapsanoRadku: (pocet as number | null) ?? 0 })
}
