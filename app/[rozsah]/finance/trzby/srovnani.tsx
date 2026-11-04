import Link from 'next/link'

import DataTable from '@/components/ui/DataTable'
import { koruny } from '@/lib/mzdy'
import { pocet } from '@/lib/sklonovani'
import {
  dilkyOsy,
  popiskyOsy,
  popisRozdilu,
  popisRozsahu,
  popisUseku,
  type DruhSrovnani,
  type GrafSrovnani,
  type HodnotaSlotu,
  type SlotGrafu,
} from '@/lib/trzby-srovnani'
import { PanelHlava } from '../../dnes/prvky'
import GrafSrovnaniKresba, { type SlotKresby } from './graf-srovnani'

/**
 * Karta „Srovnání tržeb" na Finance → Tržby (Šéfík 4. 11. 2026, podle
 * karty „Měsíční tržby" z Dotykačky). Serverová: z hotového
 * `GrafSrovnani` (lib/trzby-srovnani.ts) poskládá texty, věty o tom, co
 * v datech chybí, přepínač srovnání a tabulku — kresbu dělá klientský
 * `graf-srovnani.tsx`.
 *
 * Tabulka pod grafem je jeho rovnocenné dvojče (stejná čísla bez myši
 * i pro čtečku obrazovky) a zároveň obdoba tlačítka „Detail" z Dotykačky.
 */

/** Popisky přepínače u členění po dnech. U roku je srovnání jen jedno (předchozí rok). */
export const NAZVY_SROVNANI: Readonly<Record<DruhSrovnani, string>> = {
  obdobi: 'Předchozí měsíc',
  rok: 'Stejný měsíc loni',
}

function velke(t: string): string {
  return t.charAt(0).toLocaleUpperCase('cs-CZ') + t.slice(1)
}

function den(iso: string): string {
  return `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}.`
}

function nazvy(h: HodnotaSlotu, nazvyPobocek: ReadonlyMap<string, string>): string {
  return h.pobocky.map((b) => nazvyPobocek.get(b) ?? 'jiná provozovna').join(', ')
}

function textHodnoty(h: HodnotaSlotu | null, mesice: boolean): string {
  if (h === null) return 'bez dat'
  if (!mesice) return koruny(h.haleru)
  // Dny jedné provozovny; liší-li se mezi provozovnami, rozpětí — součet by lhal („62 dní" v měsíci).
  const dny = h.dnuNejmene === h.dnu ? pocet(h.dnu, 'den', 'dny', 'dní') : `${h.dnuNejmene}–${h.dnu} dní podle provozovny`
  return `${koruny(h.haleru)} (${dny})`
}

/** Sloty grafu → hotové texty pro kresbu a tabulku (žádné formátování v klientu). */
export function slotyKresby(graf: GrafSrovnani, nazvyPobocek: ReadonlyMap<string, string>): SlotKresby[] {
  const mesice = graf.cleneni === 'mesic'
  return graf.sloty.map((s: SlotGrafu) => {
    const poznamky: string[] = []
    if (s.stav === 'bezi' && s.aktualni !== null) poznamky.push(`ještě běží — data zatím do ${den(graf.dnes)}, rozdíl se neukazuje`)
    if (s.jinePobocky && s.aktualni !== null && s.srovnani !== null) {
      poznamky.push(`nesrovnává stejné provozovny: ${nazvy(s.aktualni, nazvyPobocek)} proti ${nazvy(s.srovnani, nazvyPobocek)}`)
    }
    if (s.maloDni !== null) {
      const m = s.maloDni
      poznamky.push(
        `jiný počet prodejních dní: ${nazvyPobocek.get(m.branchId) ?? 'provozovna'} ${pocet(m.dnu, 'den', 'dny', 'dní')} proti ${m.dnuSrovnani} ve srovnání, rozdíl se neukazuje`,
      )
    }
    return {
      osa: s.osa,
      osaSlovem: s.osaSlovem,
      popis: s.popis,
      popisSrovnani: s.popisSrovnani,
      aktualni: s.aktualni?.haleru ?? null,
      srovnani: s.srovnani?.haleru ?? null,
      textAktualni: s.aktualni === null && s.stav === 'budouci' ? 'ještě nenastalo' : textHodnoty(s.aktualni, mesice),
      textSrovnani:
        s.obdobiSrovnani === null
          ? 'tento den srovnání nemá'
          : graf.pokryti.druh === 'nenacteno'
            ? 'nenačteno'
            : textHodnoty(s.srovnani, mesice),
      rozdil: s.rozdilProcent === null ? null : popisRozdilu(s.rozdilProcent),
      poznamka: poznamky.length > 0 ? poznamky.join('; ') : null,
      stav: s.stav,
    }
  })
}

/**
 * Věty, které graf říká NAHLAS (nad kresbou) — co ve srovnání chybí nebo
 * nesedí. Prázdné pole = srovnání je celé a poctivé.
 */
export function vetyOSrovnani(graf: GrafSrovnani): { varovani: string[]; poznamky: string[] } {
  const varovani: string[] = []
  const poznamky: string[] = []
  const srov = graf.nazevSrovnani
  if (graf.pokryti.druh === 'nenacteno') {
    varovani.push(`Srovnávací období (${srov}) se nepodařilo načíst, sloupce ukazují jen ${graf.nazevAktualniho}. Zkuste stránku obnovit.`)
  } else if (graf.pokryti.druh === 'bez_dat') {
    varovani.push(
      `Za ${srov} nemá appka z pokladny žádné tržby, takže čára srovnání chybí. Neznamená to nulové tržby — pokladna tehdy nejspíš ještě nebyla napojená.`,
    )
  } else if (graf.pokryti.druh === 'castecne') {
    varovani.push(
      `Srovnávací období má v appce tržby jen za ${popisUseku(graf.cleneni, graf.pokryti.od, graf.pokryti.do)}. Kde čára chybí, data nejsou — není to nula.`,
    )
  }
  const jine = graf.slotySJinymiPobockami
  if (jine.length > 0) {
    // Po dnech jich bývá hodně (provozovna, která má jeden den v týdnu zavřeno,
    // vychází jinak než ve srovnávacím měsíci) — dlouhý výčet by větu utopil.
    const kde =
      jine.length <= 3
        ? `${jine.join(', ')}: srovnání v ${jine.length === 1 ? 'něm' : 'nich'} zahrnuje`
        : `U ${jine.length} ${graf.cleneni === 'den' ? 'dnů' : 'měsíců'} (${jine.slice(0, 3).join(', ')} a další) zahrnuje srovnání`
    varovani.push(
      `${kde} jiné provozovny než zobrazené období — některá měla zavřeno nebo ještě nebyla napojená. Rozdíl v procentech proto appka neukazuje; které to jsou, ukáže bublina nad sloupcem i tabulka.`,
    )
  }
  const malo = graf.slotySMaloDny
  if (malo.length > 0) {
    const kde =
      malo.length <= 3
        ? `${malo.join(', ')}: jedna strana srovnání má v ${malo.length === 1 ? 'něm' : 'nich'}`
        : `U ${malo.length} ${graf.cleneni === 'den' ? 'dnů' : 'měsíců'} (${malo.slice(0, 3).join(', ')} a další) má jedna strana srovnání`
    varovani.push(
      `${kde} výrazně méně prodejních dní než druhá — pokladna byla nejspíš napojená až v průběhu měsíce, nebo bylo dlouho zavřeno. Rozdíl v procentech proto appka neukazuje; počty dní ukáže bublina nad sloupcem i tabulka.`,
    )
  }
  if (graf.bezi !== null) {
    poznamky.push(
      graf.cleneni === 'mesic'
        ? `${graf.bezi.popis} ještě běží: světlejší sloupec má data zatím do ${den(graf.dnes)} a srovnává se s celým měsícem, proto u něj rozdíl v procentech není.`
        : `Dnešek ještě běží a pokladna ho dosílá: světlejší sloupec není konečný a rozdíl v procentech se u něj neukazuje.`,
    )
  }
  return { varovani, poznamky }
}

export default function KartaSrovnani({
  graf,
  nazvyPobocek,
  odkazNaDruh,
}: {
  graf: GrafSrovnani
  nazvyPobocek: ReadonlyMap<string, string>
  /** Adresa stránky se zvoleným srovnáním (jen u členění po dnech). */
  odkazNaDruh: (druh: DruhSrovnani) => string
}) {
  const sloty = slotyKresby(graf, nazvyPobocek)
  const maxHaleru = Math.max(0, ...graf.sloty.flatMap((s) => [s.aktualni?.haleru ?? 0, s.srovnani?.haleru ?? 0]))
  const dilky = dilkyOsy(maxHaleru)
  const { varovani, poznamky } = vetyOSrovnani(graf)
  const akt = velke(graf.nazevAktualniho)
  const srov = graf.nazevSrovnani

  return (
    <section className="ds-plocha ds-graf-karta" aria-label="Srovnání tržeb">
      <div className="ds-graf-hlava">
        <div style={{ minWidth: 0 }}>
          <PanelHlava ikona="trend" nadpis="Srovnání tržeb" />
          <p className="ds-graf-podnadpis">
            {akt} · porovnání vůči {popisRozsahu(graf.rozsahSrovnani)}
          </p>
        </div>
        {graf.cleneni === 'den' ? (
          <div role="group" aria-label="Srovnat s" className="ds-graf-prepinac">
            {(['obdobi', 'rok'] as const).map((d) => (
              <Link key={d} href={odkazNaDruh(d)} scroll={false} className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-current={graf.druh === d ? 'true' : undefined}>
                {NAZVY_SROVNANI[d]}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      {varovani.map((v) => (
        <p key={v} className="hlaska-vareni" style={{ margin: 0 }}>{v}</p>
      ))}

      <GrafSrovnaniKresba
        sloty={sloty}
        dilky={dilky}
        popiskyDilku={popiskyOsy(dilky)}
        nazevAktualniho={akt}
        nazevSrovnani={velke(srov)}
        srovnaniBezDat={graf.pokryti.druh === 'bez_dat' || graf.pokryti.druh === 'nenacteno'}
        osaX={graf.cleneni === 'mesic' ? 'Měsíc' : 'Den v měsíci'}
        popisGrafu={`Graf srovnání tržeb: sloupce ${akt}, čára ${srov}, ${graf.cleneni === 'mesic' ? 'po měsících' : 'po dnech'}.`}
      />

      {poznamky.map((p) => (
        <p key={p} className="ds-graf-poznamka">{p}</p>
      ))}
      <p className="ds-graf-poznamka">
        Kde sloupec nebo bod čáry chybí, pokladna za {graf.cleneni === 'mesic' ? 'ten měsíc' : 'ten den'} nic neposlala — není to nula.
        Tržby jsou za provozní den pobočky, stejně jako v tabulce níže.
      </p>

      <details className="ds-graf-tabulka">
        <summary>Tabulka srovnání</summary>
        <DataTable<SlotKresby>
          zebra
          klicRadku={(r) => r.popis}
          sloupce={[
            { klic: 'obdobi', hlavicka: graf.cleneni === 'mesic' ? 'Měsíc' : 'Den', vykresli: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.popis}</span> },
            { klic: 'aktualni', hlavicka: akt, zarovnaniVpravo: true, vykresli: (r) => <span className="ds-graf-cislo">{r.aktualni === null ? '–' : r.textAktualni}</span> },
            {
              klic: 'srovnani',
              hlavicka: velke(srov),
              zarovnaniVpravo: true,
              vykresli: (r) => (
                <span className="ds-graf-cislo">
                  {r.srovnani === null ? '–' : r.textSrovnani}
                  {graf.cleneni === 'den' && r.popisSrovnani ? <span className="ds-graf-tabulka-den"> {r.popisSrovnani}</span> : null}
                </span>
              ),
            },
            { klic: 'rozdil', hlavicka: 'Rozdíl', zarovnaniVpravo: true, vykresli: (r) => <span className="ds-graf-cislo">{r.rozdil ?? ''}</span> },
            { klic: 'pozn', hlavicka: 'Poznámka', vykresli: (r) => <span style={{ color: 'var(--muted)' }}>{r.poznamka ?? ''}</span> },
          ]}
          radky={sloty}
        />
      </details>
    </section>
  )
}
