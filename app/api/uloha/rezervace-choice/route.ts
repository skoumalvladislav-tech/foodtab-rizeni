import { NextResponse } from 'next/server'

import { tajemstviSedi, uzBezi } from '@/lib/supabase/uloha'
import { NEJMENE_NA_PRIPOJENI_MS, ROZESTUP_DOTAZU_MS } from '@/lib/rezervace-choice'
import { choiceKSynchronizaci, REZERVA_DOTAZU_MS, synchronizovatChoice } from '@/lib/rezervace-choice-sync'

/**
 * Naplánovaná úloha: načtení rezervací z Choice (choiceqr.com) do
 * Provoz → Rezervace a akce. Každých 15 minut
 * (.github/workflows/rezervace-choice.yml, `app.planovac_ulohy`).
 *
 * Choice rezervace neposílá sám (webhooky pro rezervace nemá), proto se
 * Foodtab ptá. Do Choice nic nezapisuje.
 *
 * Stejný vzor jako `pokladna-synchronizace`: Bearer CRON_SECRET,
 * `service_role`, žádný přihlášený. Mezi všemi dotazy na Choice drží
 * rozestup 5,5 s databázová fronta (`rezervace_choice_zabrat_dotaz`) —
 * i mezi pobočkami a souběžnými běhy. Když Choice vrátí 429, úloha
 * skončí a zkusí to příště.
 *
 * DĚLENÍ ČASU (prověrka 25. 10.): rezerva na poslední dotaz a zápis se
 * odečte JEDNOU za celou úlohu a zbytek se dělí mezi připojení — každé
 * dostane stejný díl, nejméně `NEJMENE_NA_PRIPOJENI_MS` (blízko, nové
 * a aspoň stránka okna). Na koho už takový díl nezbude, ten se v tomhle
 * běhu nezačne; nemá nový běh, a proto jde příště první
 * (`poradiSynchronizace`). Připojení se tak střídají a každé projde
 * celé okno — při víc připojeních jen méně často.
 *
 * Díl se počítá od odchodu PRVNÍHO dotazu připojení (čekání na frontu
 * ho neukusuje) a připojení, po jehož dílu by na další nezbyl celý
 * nejmenší díl, dočte zbytek úlohy (`konecDiluUlohy`, nezávislé ověření
 * PR #163). Tlačítka vedle úlohy ji tak stojí nejvýš místa ve frontě,
 * která sama zabrala.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Tvrdý konec úlohy (limit 60 s). */
const KONEC_PO_MS = 57_000

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const bezi = await uzBezi('rezervace-choice')
  if (bezi) return bezi

  const konecUlohy = Date.now() + KONEC_PO_MS
  // Poslední dotaz celé úlohy smí odejít nejpozději tady — po něm zbývá
  // rezerva na odpověď a zápis. (Až tady, ne nahoře v modulu: import se
  // nesmí číst při načtení adresy.)
  const posledniDotazUlohy = konecUlohy - REZERVA_DOTAZU_MS
  const pripojeni = await choiceKSynchronizaci()

  // Bez id připojení a bez textů chyb: odpověď končí ve veřejném logu
  // GitHub Actions. Důvod je u napojení v Rezervace → Napojení a import.
  const vysledky: { stav: string; dotazu: number; nacteno: number; pokracovani: boolean }[] = []
  let omezeno = false
  // Konec dílu předchozího připojení (`konecDiluMs`), nebo nic.
  let konecDilu: number | null = null
  for (const [i, id] of pripojeni.entries()) {
    // Zbývající čas se počítá od konce dílu předchozího připojení, když
    // ho vyčerpalo — ne od chvíle, kdy doběhla odpověď na jeho poslední
    // dotaz. Připojení samo dočte zbytek úlohy, když po jeho dílu nezbude
    // celý nejmenší díl (`konecDiluUlohy`); tady se musí rozhodnout
    // podle téhož okamžiku, jinak by čas mezi nimi propadl (nezávislé
    // ověření PR #163).
    const zbyva = posledniDotazUlohy - Math.min(Date.now(), konecDilu ?? Infinity)
    if (zbyva < NEJMENE_NA_PRIPOJENI_MS) break
    // A tři dotazy se musí vejít i od teď (první hned, pak dva rozestupy)
    // — to padne jen při pomalých odpovědích Choice.
    if (posledniDotazUlohy - Date.now() < NEJMENE_NA_PRIPOJENI_MS - ROZESTUP_DOTAZU_MS) break
    // Stejný díl zbývajícího času každému zbývajícímu připojení, ale ne
    // méně než na tři dotazy.
    const dil = Math.max(NEJMENE_NA_PRIPOJENI_MS, Math.floor(zbyva / (pripojeni.length - i)))
    // `uloha: true` — jen úloha jde do fronty vlastním vstupem bez pravidla
    // firmy (migrace 20261102100000); tlačítka čekají nejvýš dva rozestupy.
    // Díl (`dilMs`) se počítá od odchodu PRVNÍHO dotazu připojení, ne od
    // teď: když tlačítko vzalo poslední místo dílu předchozího připojení,
    // čekání tohohle na frontu mu díl neukousne (nezávislé ověření PR #163
    // — se třemi připojeními úloha přišla o dotaz víc, než kolik jich
    // tlačítko udělalo). Tlačítko tak úlohu stojí nejvýš místa, která samo
    // zabralo. Konec celé úlohy (`posledniDotazUlohy`) platí pro všechny.
    const v = await synchronizovatChoice(id, {
      konecMs: konecUlohy,
      posledniDotazMs: posledniDotazUlohy,
      dilMs: dil,
      uloha: true,
    })
    vysledky.push({ stav: v.stav, dotazu: v.dotazu, nacteno: v.nacteno, pokracovani: v.pokracovani })
    if (v.omezeno) {
      omezeno = true
      break
    }
    konecDilu = v.konecDiluMs
  }

  return NextResponse.json({
    pripojeni: pripojeni.length,
    zpracovano: vysledky.length,
    ok: vysledky.filter((v) => v.stav === 'ok').length,
    chyby: vysledky.filter((v) => v.stav === 'chyba').length,
    preskoceno: vysledky.filter((v) => v.stav === 'preskoceno').length,
    omezeno,
    vysledky,
  })
}
