/**
 * Měsíční rozpis jako PDF — stránky z modelu `ExportMesice`.
 *
 * ---------------------------------------------------------------------
 * A4 NA VÝŠKU, TÝDNY POD SEBOU
 *
 * Měsíc o 30 sloupcích se na A4 nevejde tak, aby byl čitelný —
 * „8–16“ by musela být písmem, které se nedá číst. Proto jedna tabulka
 * na TÝDEN (sedm dní od pondělí, jako mřížka na obrazovce). Sloupec dne
 * je asi 56 bodů, což na „10:00–22:00“ písmem 7 pt stačí; trhaná směna
 * má pod časem druhý řádek „pauza 15–17“.
 *
 * Týdny se na stránku skládají pod sebe, dokud se vejdou celé; týden se
 * nikdy netrhá, pokud se vejde na prázdnou stránku (menší podnik má tak
 * dva týdny na stránce, větší jeden). Týden vyšší než stránka pokračuje
 * na další se záhlavím tabulky znovu a úseky se drží pohromadě s aspoň
 * jedním řádkem. Dny mimo měsíc (začátek a konec týdne) jsou šedé a
 * prázdné, ať je jasné, že tam rozpis tenhle export nepokrývá. Na konci
 * je souhrn hodin za celý měsíc.
 */

import { denVTydnu, jeVikend, ZKRATKY_DNU } from './rozpis-mobil.ts'
import { hodinyCislem, nazevMesice, pauzaKratce, popisTydne, type DilSmeny, type ExportMesice, type RadekExportu } from './rozpis-export.ts'
import { sirkaTextu, StrankaPdf, zapsatPdf, zkratitText, type Barva } from './pdf-zapis.ts'

/** A4 na výšku v bodech (1 bod = 1/72″). */
export const A4_SIRKA = 595
export const A4_VYSKA = 842
export const OKRAJ = 28

const CERNA: Barva = [0.09, 0.1, 0.11]
const SEDA: Barva = [0.42, 0.44, 0.47]
const LINKA: Barva = [0.82, 0.8, 0.76]
const HLAVICKA: Barva = [0.93, 0.92, 0.9]
const SKUPINA: Barva = [0.96, 0.95, 0.94]
const VIKEND: Barva = [0.98, 0.94, 0.85]
const MIMO: Barva = [0.94, 0.94, 0.94]

/** Kde končí záhlaví stránky (nadpis měsíce) a kde začíná obsah. */
const ZACATEK_OBSAHU = OKRAJ + 28
const PATA_STRANKY = 22
/** Nejníž, kam smí sahat tabulky; pod tím je zápatí. */
export const DOLNI_HRANICE = A4_VYSKA - OKRAJ - PATA_STRANKY

const VYSKA_NADPISU = 16
const VYSKA_HLAVICKY_TABULKY = 26
const VYSKA_RADKU = 21
const VYSKA_SKUPINY = 13
const VYSKA_SOUCTU = 15
const MEZERA_BLOKU = 10
const RADEK_SMENY = 8.5
const RADEK_PAUZY = 7.5
const VYSKA_RADKU_SOUHRNU = 15
const VYSKA_HLAVICKY_SOUHRNU = 17

/** Minuty jako české číslo hodin: 1890 → „31,5“, 480 → „8“. */
const hod = (minut: number) => String(hodinyCislem(minut)).replace('.', ',')

/** Výška obsahu buňky dne: čas směny a případně pauza pod ním. */
function vyskaDne(dily: DilSmeny[]): number {
  return dily.reduce((v, d) => v + RADEK_SMENY + (d.pauza ? RADEK_PAUZY : 0), 0)
}

export function pdfZExportu(m: ExportMesice): Uint8Array {
  const stranky: StrankaPdf[] = []
  // Aktuální stránka. První hodnota je jen kvůli typu — než se cokoli
  // kreslí, `novaStranka` ji nahradí skutečnou a zařadí do dokumentu.
  let s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
  let y = 0
  /** Znovu vykreslí nadpis a záhlaví tabulky, když se tabulka zalomí na novou stránku. */
  let obnovaZahlavi: (() => void) | null = null

  const sirkaObsahu = A4_SIRKA - 2 * OKRAJ
  const sloupecJmen = m.vicePobocek ? 122 : 112
  const sloupecHodin = 34
  const sloupecDne = (sirkaObsahu - sloupecJmen - sloupecHodin) / 7

  const mimoMesic = (d: string) => !d.startsWith(m.mesic)

  const novaStranka = () => {
    s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
    stranky.push(s)
    s.text(m.nadpis, OKRAJ, OKRAJ + 11, { velikost: 13, pismo: 'tucne', barva: CERNA })
    s.text(zkratitText(m.rozsah, sirkaObsahu / 2, 9), A4_SIRKA - OKRAJ, OKRAJ + 11, { velikost: 9, barva: SEDA, zarovnani: 'r' })
    s.cara(OKRAJ, OKRAJ + 17, A4_SIRKA - OKRAJ, OKRAJ + 17, LINKA)
    y = ZACATEK_OBSAHU
  }

  /** Zalomí na novou stránku a vrátí tam záhlaví právě rozdělané tabulky. */
  const zalomit = () => {
    novaStranka()
    obnovaZahlavi?.()
  }

  /** Nevejde-li se `vyska` na zbytek stránky, začne nová. */
  const misto = (vyska: number) => {
    if (y + vyska > DOLNI_HRANICE) zalomit()
  }

  /**
   * Začátek samostatného bloku (týden, souhrn): drží se pohromadě, pokud
   * se vejde na prázdnou stránku; jinak začne nahoře a poteče dál.
   */
  const zacniBlok = (vyska: number) => {
    obnovaZahlavi = null
    if (stranky.length === 0) novaStranka()
    else if (y > ZACATEK_OBSAHU && y + MEZERA_BLOKU + vyska > DOLNI_HRANICE) novaStranka()
    else if (y > ZACATEK_OBSAHU) y += MEZERA_BLOKU
  }

  const nadpisSekce = (text: string) => {
    s.text(text, OKRAJ, y + 11, { velikost: 9.5, pismo: 'tucne', barva: CERNA })
    y += VYSKA_NADPISU
  }

  /* --- týdenní tabulka --------------------------------------------- */

  const hlavickaTydne = (dny: string[]) => {
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, VYSKA_HLAVICKY_TABULKY, { vypln: HLAVICKA, ramecek: LINKA })
    s.text('Zaměstnanec', x + 5, y + 16, { velikost: 8, pismo: 'tucne', barva: CERNA })
    x += sloupecJmen
    for (const d of dny) {
      s.obdelnik(x, y, sloupecDne, VYSKA_HLAVICKY_TABULKY, {
        vypln: mimoMesic(d) ? MIMO : jeVikend(d) ? VIKEND : HLAVICKA,
        ramecek: LINKA,
      })
      const [, mm, dd] = d.split('-').map(Number)
      s.text(`${ZKRATKY_DNU[denVTydnu(d)][0]}${ZKRATKY_DNU[denVTydnu(d)][1].toLowerCase()} ${dd}. ${mm}.`, x + sloupecDne / 2, y + 11, {
        velikost: 7.5,
        pismo: 'tucne',
        barva: mimoMesic(d) ? SEDA : CERNA,
        zarovnani: 'c',
      })
      const minut = m.poDnech.get(d)
      s.text(mimoMesic(d) ? '' : minut ? `${hod(minut)} h` : '—', x + sloupecDne / 2, y + 21, {
        velikost: 7,
        barva: SEDA,
        zarovnani: 'c',
      })
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, VYSKA_HLAVICKY_TABULKY, { vypln: HLAVICKA, ramecek: LINKA })
    s.text('Hodin', x + sloupecHodin / 2, y + 16, { velikost: 8, pismo: 'tucne', barva: CERNA, zarovnani: 'c' })
    y += VYSKA_HLAVICKY_TABULKY
  }

  const vyskaRadku = (r: RadekExportu, dny: string[]) =>
    Math.max(VYSKA_RADKU, 5 + Math.max(0, ...dny.map((d) => vyskaDne(r.dilyPodleDne.get(d) ?? []))) + 2)

  const kresliRadek = (r: RadekExportu, dny: string[], vyska: number) => {
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, vyska, { ramecek: LINKA })
    s.text(zkratitText(r.jmeno, sloupecJmen - 8, 8, 'tucne'), x + 4, y + 9, { velikost: 8, pismo: 'tucne', barva: CERNA })
    const podtitul = [r.pozice, m.vicePobocek ? r.pobocka : ''].filter(Boolean).join(' · ')
    if (podtitul) s.text(zkratitText(podtitul, sloupecJmen - 8, 6.5, 'normal'), x + 4, y + 17, { velikost: 6.5, barva: SEDA })
    x += sloupecJmen
    for (const d of dny) {
      s.obdelnik(x, y, sloupecDne, vyska, {
        vypln: mimoMesic(d) ? MIMO : jeVikend(d) ? VIKEND : undefined,
        ramecek: LINKA,
      })
      let radek = y + 9
      for (const dil of r.dilyPodleDne.get(d) ?? []) {
        s.text(zkratitText(`${dil.cas}${dil.nevydana ? '*' : ''}`, sloupecDne - 4, 7, 'normal'), x + sloupecDne / 2, radek, {
          velikost: 7,
          barva: CERNA,
          zarovnani: 'c',
        })
        radek += RADEK_SMENY
        if (dil.pauza) {
          // Pauza je vedlejší údaj: 6 pt, a když se ani tak nevejde, 5,5 pt.
          const textPauzy = `pauza ${pauzaKratce(dil.pauza)}`
          const velikostPauzy = sirkaTextu(textPauzy, 6) <= sloupecDne - 4 ? 6 : 5.5
          s.text(zkratitText(textPauzy, sloupecDne - 4, velikostPauzy, 'normal'), x + sloupecDne / 2, radek - 1, {
            velikost: velikostPauzy,
            barva: SEDA,
            zarovnani: 'c',
          })
          radek += RADEK_PAUZY
        }
      }
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, vyska, { ramecek: LINKA })
    const minutTydne = dny.reduce((k, d) => k + (r.minutPodleDne.get(d) ?? 0), 0)
    s.text(minutTydne > 0 ? hod(minutTydne) : '—', x + sloupecHodin / 2, y + 9, {
      velikost: 7.5,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    y += vyska
  }

  const maNeobsazene = (dny: string[]) =>
    !!m.neobsazene && dny.some((d) => (m.neobsazene?.podleDne.get(d) ?? []).length > 0)

  /** Výška celého týdne — podle ní se rozhoduje, jestli se vejde pod předchozí. */
  const vyskaTydne = (dny: string[]) => {
    let v = VYSKA_NADPISU + VYSKA_HLAVICKY_TABULKY + VYSKA_SOUCTU
    for (const g of m.skupiny) v += VYSKA_SKUPINY + g.radky.reduce((k, r) => k + vyskaRadku(r, dny), 0)
    if (m.neobsazene && maNeobsazene(dny)) v += VYSKA_SKUPINY + vyskaRadku(m.neobsazene, dny)
    return v
  }

  for (const [poradi, dny] of m.tydny.entries()) {
    const nadpis = `Týden ${poradi + 1} · ${popisTydne(dny)}`
    zacniBlok(vyskaTydne(dny))
    nadpisSekce(nadpis)
    hlavickaTydne(dny)
    obnovaZahlavi = () => {
      nadpisSekce(`${nadpis} (pokračování)`)
      hlavickaTydne(dny)
    }

    const kresliSkupinu = (nazev: string, prvni: RadekExportu) => {
      misto(VYSKA_SKUPINY + vyskaRadku(prvni, dny))
      s.obdelnik(OKRAJ, y, sirkaObsahu, VYSKA_SKUPINY, { vypln: SKUPINA, ramecek: LINKA })
      s.text(nazev.toUpperCase(), OKRAJ + 4, y + 9.5, { velikost: 7, pismo: 'tucne', barva: SEDA })
      y += VYSKA_SKUPINY
    }

    const kresli = (r: RadekExportu) => {
      const vyska = vyskaRadku(r, dny)
      misto(vyska)
      kresliRadek(r, dny, vyska)
    }

    for (const skupina of m.skupiny) {
      kresliSkupinu(skupina.nazev, skupina.radky[0])
      skupina.radky.forEach(kresli)
    }
    if (m.neobsazene && maNeobsazene(dny)) {
      kresliSkupinu('Neobsazené směny', m.neobsazene)
      kresli(m.neobsazene)
    }

    // Součet týdne (jen lidé; neobsazené směny se nepočítají).
    misto(VYSKA_SOUCTU)
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, VYSKA_SOUCTU, { vypln: SKUPINA, ramecek: LINKA })
    s.text('Celkem hodin', x + 4, y + 10, { velikost: 7.5, pismo: 'tucne', barva: CERNA })
    x += sloupecJmen
    let soucetTydne = 0
    for (const d of dny) {
      const minut = mimoMesic(d) ? 0 : (m.poDnech.get(d) ?? 0)
      soucetTydne += minut
      s.obdelnik(x, y, sloupecDne, VYSKA_SOUCTU, { vypln: SKUPINA, ramecek: LINKA })
      s.text(minut > 0 ? hod(minut) : '—', x + sloupecDne / 2, y + 10, {
        velikost: 7.5,
        pismo: 'tucne',
        barva: CERNA,
        zarovnani: 'c',
      })
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, VYSKA_SOUCTU, { vypln: SKUPINA, ramecek: LINKA })
    s.text(soucetTydne > 0 ? hod(soucetTydne) : '—', x + sloupecHodin / 2, y + 10, {
      velikost: 7.5,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    y += VYSKA_SOUCTU
  }

  /* --- souhrn za měsíc ------------------------------------------------ */

  // Šířky vyplní celou šířku obsahu; poslední dva sloupce jsou čísla.
  const sloupceSouhrnu = m.vicePobocek
    ? [
        { nazev: 'Zaměstnanec', sirka: 120 },
        { nazev: 'Úsek', sirka: 80 },
        { nazev: 'Pozice', sirka: 80 },
        { nazev: 'Z toho po pobočkách', sirka: 155 },
        { nazev: 'Směn', sirka: 50 },
        { nazev: 'Hodin', sirka: sirkaObsahu - 485 },
      ]
    : [
        { nazev: 'Zaměstnanec', sirka: 170 },
        { nazev: 'Úsek', sirka: 120 },
        { nazev: 'Pozice', sirka: 120 },
        { nazev: 'Směn', sirka: 55 },
        { nazev: 'Hodin', sirka: sirkaObsahu - 465 },
      ]
  const nadpisSouhrnu = `Souhrn hodin — ${nazevMesice(m.mesic)}`
  const hlavickaSouhrnu = () => {
    let x = OKRAJ
    for (const [i, c] of sloupceSouhrnu.entries()) {
      const cislo = i >= sloupceSouhrnu.length - 2
      s.obdelnik(x, y, c.sirka, VYSKA_HLAVICKY_SOUHRNU, { vypln: HLAVICKA, ramecek: LINKA })
      s.text(c.nazev, cislo ? x + c.sirka - 5 : x + 5, y + 11.5, {
        velikost: 8,
        pismo: 'tucne',
        barva: CERNA,
        zarovnani: cislo ? 'r' : 'l',
      })
      x += c.sirka
    }
    y += VYSKA_HLAVICKY_SOUHRNU
  }
  zacniBlok(VYSKA_NADPISU + VYSKA_HLAVICKY_SOUHRNU + (m.souhrn.length + 1) * VYSKA_RADKU_SOUHRNU)
  nadpisSekce(nadpisSouhrnu)
  hlavickaSouhrnu()
  obnovaZahlavi = () => {
    nadpisSekce(`${nadpisSouhrnu} (pokračování)`)
    hlavickaSouhrnu()
  }
  const radekSouhrnu = (hodnoty: string[], tucne = false, vypln?: Barva) => {
    misto(VYSKA_RADKU_SOUHRNU)
    let x = OKRAJ
    sloupceSouhrnu.forEach((c, i) => {
      s.obdelnik(x, y, c.sirka, VYSKA_RADKU_SOUHRNU, { vypln, ramecek: LINKA })
      const cislo = i >= sloupceSouhrnu.length - 2
      s.text(zkratitText(hodnoty[i] ?? '', c.sirka - 10, 8, tucne ? 'tucne' : 'normal'), cislo ? x + c.sirka - 5 : x + 5, y + 10.5, {
        velikost: 8,
        pismo: tucne ? 'tucne' : 'normal',
        barva: CERNA,
        zarovnani: cislo ? 'r' : 'l',
      })
      x += c.sirka
    })
    y += VYSKA_RADKU_SOUHRNU
  }
  for (const r of m.souhrn) {
    radekSouhrnu([r.jmeno, r.usek, r.pozice, ...(m.vicePobocek ? [r.pobocky] : []), String(r.smen), hod(r.minut)])
  }
  radekSouhrnu(
    ['Celkem', '', '', ...(m.vicePobocek ? [''] : []), String(m.souhrn.reduce((n, r) => n + r.smen, 0)), hod(m.celkemMinut)],
    true,
    SKUPINA,
  )

  /* --- zápatí na každé stránce ---------------------------------------- */

  stranky.forEach((st, i) => {
    const caraY = A4_VYSKA - OKRAJ - PATA_STRANKY + 6
    st.cara(OKRAJ, caraY, A4_SIRKA - OKRAJ, caraY, LINKA)
    const yPaty = A4_VYSKA - OKRAJ + 2
    st.text(`Vytvořeno ${m.vytvoreno}`, OKRAJ, yPaty, { velikost: 7, barva: SEDA })
    st.text(
      m.nevydanych > 0
        ? `* nevydaná směna (celkem ${m.nevydanych}) · hodiny = plánované délky směn bez automatické přestávky`
        : 'Hodiny = plánované délky směn bez automatické přestávky',
      A4_SIRKA / 2 + 20,
      yPaty,
      { velikost: 7, barva: SEDA, zarovnani: 'c' },
    )
    st.text(`Strana ${i + 1} z ${stranky.length}`, A4_SIRKA - OKRAJ, yPaty, { velikost: 7, barva: SEDA, zarovnani: 'r' })
  })

  return zapsatPdf(stranky, { nazev: m.nadpis })
}
