import { NextResponse } from 'next/server'

import { rozsifrovat } from '@/lib/integrace-klice'
import { overitDavkuRezervaci, POSKYTOVATEL_PRIJMU, rozebratKlicRezervaci } from '@/lib/rezervace-prijem-api'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Příjmové API Foodtabu pro rezervace — `POST /api/rezervace/prijem`.
 *
 * Šéfík 25. 10. 2026: „mám Choice, ale připravil bych univerzální
 * možnost". Rezervační systém (webhookem) nebo n8n/Make/Zapier pošle
 * rezervace s klíčem, který appka vydala v Rezervace → Napojení a import
 * → Univerzální příjmové API. Popis pro integrátora: docs/rezervace-api.md.
 * Stejný vzor jako `/api/pokladna/prodeje`.
 *
 * Přihlášený člověk tu není — klíč nahrazuje přihlášení, proto
 * `service_role` (výjimka zapsaná v `lib/supabase/uloha.ts`). Klíč určuje
 * připojení, připojení určuje firmu a pobočku; z těla se bere jen obsah
 * rezervací, nikdy kam je zapsat.
 *
 * „Připojeno" tady nikdo nenastavuje: udělá to `rezervace_prijmout` až po
 * úspěšně zapsané dávce, v téže transakci.
 *
 * Odpovědi bez detailů o tom, PROČ klíč neplatí (neexistuje / odpojené /
 * vyměněný) — kdo hádá klíče, nemá se dozvědět, které id existuje.
 */

export const dynamic = 'force-dynamic'

const MAX_BAJTU = 1_000_000

function chyba(status: number, kod: string, zprava: string): NextResponse {
  return NextResponse.json({ ok: false, chyba: kod, zprava }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const klic = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7).trim() : ''
  const rozbor = klic ? rozebratKlicRezervaci(klic) : null
  const neplatnyKlic = () => chyba(401, 'neplatny_klic', 'Klíč chybí nebo neplatí (hlavička Authorization: Bearer ftrez_…).')
  if (!rozbor) return neplatnyKlic()

  const supabase = klientUlohy()
  if (!supabase) return chyba(503, 'nenastaveno', 'Příjem rezervací není na serveru nastavený.')

  const { data: pripojeni } = await supabase
    .from('integrace_pripojeni')
    .select('id, branch_id')
    .eq('id', rozbor.pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', POSKYTOVATEL_PRIJMU)
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

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BAJTU) {
    return chyba(413, 'prilis_velke', 'Dávka je větší než 1 MB — pošlete rezervace po částech.')
  }
  const text = await request.text()
  if (text.length > MAX_BAJTU) return chyba(413, 'prilis_velke', 'Dávka je větší než 1 MB — pošlete rezervace po částech.')

  let telo: unknown
  try {
    telo = JSON.parse(text)
  } catch {
    return chyba(400, 'neni_json', 'Tělo požadavku není platný JSON.')
  }

  const davka = overitDavkuRezervaci(telo)
  if (davka.stav === 'chyba') {
    // Klíč sedí — kdo spravuje napojení, má v Rezervacích vidět, proč se nic nepřidalo.
    await supabase.from('integrace_pripojeni').update({ posledni_chyba: `Poslední dávka odmítnuta: ${davka.duvod}` }).eq('id', pripojeni.id)
    return chyba(422, 'neplatna_data', davka.duvod)
  }

  const { data: souhrn, error } = await supabase.rpc('rezervace_prijmout', {
    p_pripojeni: pripojeni.id,
    p_system: davka.system,
    p_radky: davka.radky,
  })
  if (error) {
    // Chyba v datech (mimo rozsah, neplatný text, kontrola) se opakováním
    // nespraví — 422 a důvod u připojení, ne „zkuste znovu" do nekonečna.
    const vData = ['22003', '22P02', '22P05', '22007', '22008', '23514'].includes(error.code ?? '')
    await supabase.from('integrace_pripojeni').update({
      posledni_chyba: vData
        ? `Poslední dávka odmítnuta databází (${error.code}): ${error.message.slice(0, 300)}`
        : `Zápis poslední dávky selhal (${error.code ?? 'neznámá chyba'}) — má se zopakovat.`,
    }).eq('id', pripojeni.id)
    return vData
      ? chyba(422, 'neplatna_data', `Data dávky databáze odmítla: ${error.message.slice(0, 300)}`)
      : chyba(500, 'zapis_selhal', 'Rezervace se nepodařilo zapsat — zkuste to znovu.')
  }

  const s = (souhrn ?? {}) as Record<string, number>
  return NextResponse.json({
    ok: true,
    nove: Number(s.nove ?? 0),
    zmenene: Number(s.zmenene ?? 0),
    bezeZmeny: Number(s.beze_zmeny ?? 0),
    zastarale: Number(s.zastarale ?? 0),
  })
}
