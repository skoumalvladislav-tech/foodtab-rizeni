/**
 * Měsíční rozpis jako PDF — stránky z modelu `ExportMesice`.
 *
 * ---------------------------------------------------------------------
 * PROČ PO TÝDNECH
 *
 * Měsíc o 30 sloupcích se na A4 nevejde tak, aby byl čitelný —
 * „8–16“ by musela být písmem, které se nedá číst. Proto jedna tabulka
 * na TÝDEN (sedm dní od pondělí, jako mřížka na obrazovce), týdny pod
 * sebou přes stránky, a na konci souhrn hodin za celý měsíc. Dny mimo
 * měsíc (začátek a konec týdne) jsou šedé a prázdné, ať je jasné, že
 * tam rozpis tenhle export nepokrývá.
 *
 * Řádky lidí se drží pohromadě po úsecích; když se úsek na stránku
 * nevejde, pokračuje na další se záhlavím tabulky znovu.
 */

import { hodinyKratce, denVTydnu, jeVikend, ZKRATKY_DNU } from './rozpis-mobil.ts'
import { nazevMesice, type ExportMesice, type RadekExportu } from './rozpis-export.ts'
import { StrankaPdf, zapsatPdf, zkratitText, type Barva } from './pdf-zapis.ts'

const A4_SIRKA = 842
const A4_VYSKA = 595
const OKRAJ = 30

const CERNA: Barva = [0.09, 0.1, 0.11]
const SEDA: Barva = [0.42, 0.44, 0.47]
const LINKA: Barva = [0.82, 0.8, 0.76]
const HLAVICKA: Barva = [0.93, 0.92, 0.9]
const SKUPINA: Barva = [0.96, 0.95, 0.94]
const VIKEND: Barva = [0.98, 0.94, 0.85]
const MIMO: Barva = [0.94, 0.94, 0.94]

const HLAVICKA_STRANKY = 52
const PATA_STRANKY = 24
const VYSKA_HLAVICKY_TABULKY = 30
const VYSKA_RADKU = 22
const VYSKA_SKUPINY = 15
const RADEK_TEXTU = 9.5

const DEN_MESICE = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']

/** „21.–27. září“ */
function popisTydne(dny: string[]): string {
  const [, m1, d1] = dny[0].split('-').map(Number)
  const [, m2, d2] = dny[6].split('-').map(Number)
  return m1 === m2 ? `${d1}.–${d2}. ${DEN_MESICE[m2 - 1]}` : `${d1}. ${DEN_MESICE[m1 - 1]} – ${d2}. ${DEN_MESICE[m2 - 1]}`
}

export function pdfZExportu(m: ExportMesice): Uint8Array {
  const stranky: StrankaPdf[] = []
  // Aktuální stránka. První hodnota je jen kvůli typu — než se cokoli
  // kreslí, `novaStranka` ji nahradí skutečnou a zařadí do dokumentu.
  let s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
  let y = 0

  const sirkaObsahu = A4_SIRKA - 2 * OKRAJ
  const sloupecJmen = m.vicePobocek ? 150 : 138
  const sloupecHodin = 44
  const sloupecDne = (sirkaObsahu - sloupecJmen - sloupecHodin) / 7

  const mimoMesic = (d: string) => !d.startsWith(m.mesic)

  const novaStranka = (podnadpis: string) => {
    s = new StrankaPdf(A4_SIRKA, A4_VYSKA)
    stranky.push(s)
    s.text(m.nadpis, OKRAJ, OKRAJ + 12, { velikost: 15, pismo: 'tucne', barva: CERNA })
    s.text(m.rozsah, A4_SIRKA - OKRAJ, OKRAJ + 12, { velikost: 10, barva: SEDA, zarovnani: 'r' })
    s.text(podnadpis, OKRAJ, OKRAJ + 30, { velikost: 10.5, pismo: 'tucne', barva: SEDA })
    y = OKRAJ + HLAVICKA_STRANKY - 6
  }

  const dolniHranice = () => A4_VYSKA - OKRAJ - PATA_STRANKY

  /* --- týdenní tabulka --------------------------------------------- */

  const hlavickaTydne = (dny: string[]) => {
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, VYSKA_HLAVICKY_TABULKY, { vypln: HLAVICKA, ramecek: LINKA })
    s.text('Zaměstnanec', x + 5, y + 19, { velikost: 8.5, pismo: 'tucne', barva: CERNA })
    x += sloupecJmen
    for (const d of dny) {
      const vikend = jeVikend(d)
      s.obdelnik(x, y, sloupecDne, VYSKA_HLAVICKY_TABULKY, {
        vypln: mimoMesic(d) ? MIMO : vikend ? VIKEND : HLAVICKA,
        ramecek: LINKA,
      })
      const [, mm, dd] = d.split('-').map(Number)
      s.text(`${ZKRATKY_DNU[denVTydnu(d)][0]}${ZKRATKY_DNU[denVTydnu(d)][1].toLowerCase()} ${dd}. ${mm}.`, x + sloupecDne / 2, y + 13, {
        velikost: 8.5,
        pismo: 'tucne',
        barva: mimoMesic(d) ? SEDA : CERNA,
        zarovnani: 'c',
      })
      const minut = m.poDnech.get(d)
      s.text(mimoMesic(d) ? '' : minut ? hodinyKratce(minut) : '—', x + sloupecDne / 2, y + 25, {
        velikost: 7.5,
        barva: SEDA,
        zarovnani: 'c',
      })
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, VYSKA_HLAVICKY_TABULKY, { vypln: HLAVICKA, ramecek: LINKA })
    s.text('Hodin', x + sloupecHodin / 2, y + 19, { velikost: 8.5, pismo: 'tucne', barva: CERNA, zarovnani: 'c' })
    y += VYSKA_HLAVICKY_TABULKY
  }

  const radekLidi = (r: RadekExportu, dny: string[]) => {
    const radkuVDni = Math.max(1, ...dny.map((d) => (r.podleDne.get(d) ?? []).length))
    const vyska = Math.max(VYSKA_RADKU, 8 + radkuVDni * RADEK_TEXTU)
    return { vyska, radkuVDni }
  }

  const kresliRadek = (r: RadekExportu, dny: string[], vyska: number, minutTydne: number) => {
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, vyska, { ramecek: LINKA })
    s.text(zkratitText(r.jmeno, sloupecJmen - 10, 8.5, 'tucne'), x + 5, y + 10, {
      velikost: 8.5,
      pismo: 'tucne',
      barva: CERNA,
    })
    const podtitul = [r.pozice, m.vicePobocek ? r.pobocka : ''].filter(Boolean).join(' · ')
    if (podtitul) s.text(zkratitText(podtitul, sloupecJmen - 10, 7, 'normal'), x + 5, y + 19, { velikost: 7, barva: SEDA })
    x += sloupecJmen
    for (const d of dny) {
      s.obdelnik(x, y, sloupecDne, vyska, {
        vypln: mimoMesic(d) ? MIMO : jeVikend(d) ? VIKEND : undefined,
        ramecek: LINKA,
      })
      const smeny = r.podleDne.get(d) ?? []
      smeny.forEach((t, i) => {
        s.text(zkratitText(t, sloupecDne - 6, 7.5, 'normal'), x + sloupecDne / 2, y + 9 + i * RADEK_TEXTU, {
          velikost: 7.5,
          barva: CERNA,
          zarovnani: 'c',
        })
      })
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, vyska, { ramecek: LINKA })
    s.text(minutTydne > 0 ? hodinyKratce(minutTydne) : '—', x + sloupecHodin / 2, y + 10, {
      velikost: 8,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    y += vyska
  }

  for (const [poradi, dny] of m.tydny.entries()) {
    const nadpisTydne = `Týden ${poradi + 1} · ${popisTydne(dny)}`
    novaStranka(nadpisTydne)
    hlavickaTydne(dny)

    const kresliSkupinu = (nazev: string) => {
      if (y + VYSKA_SKUPINY + VYSKA_RADKU > dolniHranice()) {
        novaStranka(`${nadpisTydne} (pokračování)`)
        hlavickaTydne(dny)
      }
      s.obdelnik(OKRAJ, y, sirkaObsahu, VYSKA_SKUPINY, { vypln: SKUPINA, ramecek: LINKA })
      s.text(nazev.toUpperCase(), OKRAJ + 5, y + 10.5, { velikost: 7.5, pismo: 'tucne', barva: SEDA })
      y += VYSKA_SKUPINY
    }

    const kresli = (r: RadekExportu) => {
      const { vyska } = radekLidi(r, dny)
      if (y + vyska > dolniHranice()) {
        novaStranka(`${nadpisTydne} (pokračování)`)
        hlavickaTydne(dny)
      }
      kresliRadek(r, dny, vyska, minutyPodleDne(r, dny))
    }

    for (const skupina of m.skupiny) {
      kresliSkupinu(skupina.nazev)
      skupina.radky.forEach(kresli)
    }
    if (m.neobsazene && dny.some((d) => (m.neobsazene?.podleDne.get(d) ?? []).length > 0)) {
      kresliSkupinu('Neobsazené směny')
      kresli(m.neobsazene)
    }

    // Součet týdne (jen lidé; neobsazené směny se nepočítají).
    if (y + VYSKA_RADKU > dolniHranice()) {
      novaStranka(`${nadpisTydne} (pokračování)`)
      hlavickaTydne(dny)
    }
    let x = OKRAJ
    s.obdelnik(x, y, sloupecJmen, 16, { vypln: SKUPINA, ramecek: LINKA })
    s.text('Celkem hodin', x + 5, y + 11, { velikost: 8, pismo: 'tucne', barva: CERNA })
    x += sloupecJmen
    let soucetTydne = 0
    for (const d of dny) {
      const minut = mimoMesic(d) ? 0 : (m.poDnech.get(d) ?? 0)
      soucetTydne += minut
      s.obdelnik(x, y, sloupecDne, 16, { vypln: SKUPINA, ramecek: LINKA })
      s.text(minut > 0 ? hodinyKratce(minut) : '—', x + sloupecDne / 2, y + 11, {
        velikost: 8,
        pismo: 'tucne',
        barva: CERNA,
        zarovnani: 'c',
      })
      x += sloupecDne
    }
    s.obdelnik(x, y, sloupecHodin, 16, { vypln: SKUPINA, ramecek: LINKA })
    s.text(soucetTydne > 0 ? hodinyKratce(soucetTydne) : '—', x + sloupecHodin / 2, y + 11, {
      velikost: 8,
      pismo: 'tucne',
      barva: CERNA,
      zarovnani: 'c',
    })
    y += 16
  }

  /* --- souhrn za měsíc ------------------------------------------------ */

  novaStranka(`Souhrn hodin — ${nazevMesice(m.mesic)}`)
  const sloupceSouhrnu = [
    { nazev: 'Zaměstnanec', sirka: 200 },
    { nazev: 'Úsek', sirka: 140 },
    { nazev: 'Pozice', sirka: 130 },
    ...(m.vicePobocek ? [{ nazev: 'Z toho po pobočkách', sirka: 200 }] : []),
    { nazev: 'Směn', sirka: 50 },
    { nazev: 'Hodin', sirka: 60 },
  ]
  const hlavickaSouhrnu = () => {
    let x = OKRAJ
    for (const c of sloupceSouhrnu) {
      s.obdelnik(x, y, c.sirka, 18, { vypln: HLAVICKA, ramecek: LINKA })
      s.text(c.nazev, x + 5, y + 12, { velikost: 8.5, pismo: 'tucne', barva: CERNA })
      x += c.sirka
    }
    y += 18
  }
  hlavickaSouhrnu()
  const radekSouhrnu = (hodnoty: string[], tucne = false, vypln?: Barva) => {
    if (y + 16 > dolniHranice()) {
      novaStranka(`Souhrn hodin — ${nazevMesice(m.mesic)} (pokračování)`)
      hlavickaSouhrnu()
    }
    let x = OKRAJ
    sloupceSouhrnu.forEach((c, i) => {
      s.obdelnik(x, y, c.sirka, 16, { vypln, ramecek: LINKA })
      const cislo = i >= sloupceSouhrnu.length - 2
      s.text(zkratitText(hodnoty[i] ?? '', c.sirka - 10, 8.5, tucne ? 'tucne' : 'normal'), cislo ? x + c.sirka - 5 : x + 5, y + 11, {
        velikost: 8.5,
        pismo: tucne ? 'tucne' : 'normal',
        barva: CERNA,
        zarovnani: cislo ? 'r' : 'l',
      })
      x += c.sirka
    })
    y += 16
  }
  for (const r of m.souhrn) {
    radekSouhrnu([
      r.jmeno,
      r.usek,
      r.pozice,
      ...(m.vicePobocek ? [r.pobocky] : []),
      String(r.smen),
      hodinyKratce(r.minut),
    ])
  }
  radekSouhrnu(
    ['Celkem', '', '', ...(m.vicePobocek ? [''] : []), String(m.souhrn.reduce((n, r) => n + r.smen, 0)), hodinyKratce(m.celkemMinut)],
    true,
    SKUPINA,
  )

  if (m.nevydanych > 0) {
    y += 10
    s.text(
      `* nevydaná směna — ještě nebyla rozeslána lidem (celkem ${m.nevydanych}).`,
      OKRAJ,
      y + 8,
      { velikost: 8, barva: SEDA },
    )
  }

  /* --- patička na každé stránce ------------------------------------- */

  stranky.forEach((st, i) => {
    st.cara(OKRAJ, A4_VYSKA - OKRAJ - PATA_STRANKY + 6, A4_SIRKA - OKRAJ, A4_VYSKA - OKRAJ - PATA_STRANKY + 6, LINKA)
    const yPaty = A4_VYSKA - OKRAJ + 2
    st.text(`Vytvořeno ${m.vytvoreno}`, OKRAJ, yPaty, { velikost: 7.5, barva: SEDA })
    st.text(
      m.nevydanych > 0 ? '* nevydaná směna · hodiny = plánované délky směn bez automatické přestávky' : 'Hodiny = plánované délky směn bez automatické přestávky',
      A4_SIRKA / 2,
      yPaty,
      { velikost: 7.5, barva: SEDA, zarovnani: 'c' },
    )
    st.text(`Strana ${i + 1} z ${stranky.length}`, A4_SIRKA - OKRAJ, yPaty, { velikost: 7.5, barva: SEDA, zarovnani: 'r' })
  })

  return zapsatPdf(stranky, { nazev: m.nadpis })
}

/** Minuty člověka ve dnech týdne (jen dny měsíce). */
function minutyPodleDne(r: RadekExportu, dny: string[]): number {
  return dny.reduce((n, d) => n + (r.minutPodleDne.get(d) ?? 0), 0)
}
