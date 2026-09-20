/**
 * Měsíční rozpis jako sešit Excelu — listy z modelu `ExportMesice`.
 *
 * Dělení lidí na listy tu neurčuje sešit: přebírá se ze sdíleného
 * `vyberRozlozeni` (`lib/rozpis-rozlozeni.ts`), stejně jako v PDF. Sloupce
 * jsou v jednotkách Excelu a list se při tisku zmenší na stránku, takže
 * písmo si sešit dopočítá sám; kolik lidí kde je, ale rozhodl někdo jiný.
 */

import { jeVikend } from './rozpis-mobil.ts'
import {
  hodinyCislem,
  jmenaNalezato,
  nazevMesice,
  pauzaKratce,
  popisDne,
  radkyDoSirky,
  radkySmeny,
  vetyPoznamky,
  zalomitVety,
  type ExportMesice,
  type SloupecExportu,
} from './rozpis-export.ts'
import { vyberRozlozeni } from './rozpis-rozlozeni.ts'
import { sirkaTextu } from './pdf-zapis.ts'
import { STYL, textTisku, type BunkaXlsx, type ListXlsx } from './xlsx-zapis.ts'

const s = (v: string, styl?: number): BunkaXlsx => ({ t: 's', v, s: styl })
const n = (v: number, styl?: number): BunkaXlsx => ({ t: 'n', v, s: styl })

/*
  Rozměry listu pro tisk na jednu stránku A4 na výšku. Šířky jsou ve
  znacích Excelu (jeden znak ≈ 7 px, plus 5 px na sloupec); z nich se
  počítá, kolik lidí se vejde na list, aniž by tisk klesl pod čitelné
  měřítko — víc lidí jde na další list.
*/
const VYSKA_RADKU_XLSX = 12 // řádek písma 9 pt
const VYSKA_DROBNE_XLSX = 10 // řádek písma 7 pt
const SIRKA_DNE_XLSX = 6.5
const TISK_SIRKA_PT = (8.27 - 2 * 0.4) * 72 // A4 na výšku, okraje 0,4″
/** Šířka tiskové plochy v pixelech Excelu (bod je 0,75 px). */
const TISK_SIRKA_PX = TISK_SIRKA_PT / 0.75
/** Sloupec člověka nemá smysl táhnout donekonečna — pár lidí by mělo pruhy přes půl stránky. */
const NEJSIRSI_SLOUPEC = 16
/** Šířka sloupce Excelu (ve znacích výchozího písma) v bodech: znak ≈ 7 px + 5 px na sloupec. */
export const sirkaSloupceVBodech = (w: number) => (w * 7 + 5) * 0.75
/** Písmo jména v záhlaví sešitu (bodů) — podle něj se měří, jestli se vejde naležato. */
const PISMO_ZAHLAVI_XLSX = 9
/** Písmo času směny a součtu hodin; drobné řádky (pobočka, pauza) pod časem. */
const PISMO_CASU_XLSX = 9
const PISMO_DROBNE_XLSX = 7
/** Vzduch kolem textu v buňce (okraje buňky a mřížka), v bodech. */
const VZDUCH_BUNKY_PT = 5
/** Kolik znaků Excelu má mít sloupec, aby se do něj vešlo `pt` bodů (opak `sirkaSloupceVBodech`). */
const znakyProBody = (pt: number) => Math.ceil(((pt / 0.75 - 5) / 7) * 10) / 10

/**
 * Nejmenší šířka sloupce člověka ve znacích Excelu: co nejužší, aby se vešlo
 * všechno, co v něm je — nejdelší čas směny, nejdelší pauza (drobným písmem)
 * a součet hodin. Měří se v bodech stejným metrem jako PDF; počet znaků
 * míru lže („í“ je užší než „M“) a sloupec byl pak o polovinu širší, než
 * musel, takže se při hodně lidech tisklo mnohem menším písmem než PDF.
 *
 * Číslo, které se do buňky nevejde, Excel nezkrátí, ale zobrazí „####“ —
 * součet hodin proto hlídám nejpřísněji.
 */
export function sirkaSloupceXlsx(sloupce: SloupecExportu[]): number {
  let pt = 0
  for (const c of sloupce) {
    for (const dily of c.podleDne.values()) {
      for (const d of dily) {
        pt = Math.max(pt, sirkaTextu(`${d.kratce}${d.nevydana ? '*' : ''}`, PISMO_CASU_XLSX) + VZDUCH_BUNKY_PT)
        if (d.pauza) pt = Math.max(pt, sirkaTextu(`pauza ${pauzaKratce(d.pauza)}`, PISMO_DROBNE_XLSX) + VZDUCH_BUNKY_PT)
      }
    }
    if (c.minut > 0) pt = Math.max(pt, sirkaTextu(textSouctu(c.minut), PISMO_CASU_XLSX, 'tucne') + VZDUCH_BUNKY_PT)
  }
  return Math.min(12, Math.max(4, znakyProBody(pt)))
}

/** Součet hodin tak, jak ho Excel ukáže (formát „0.0“): „171.5“. */
const textSouctu = (minut: number) => hodinyCislem(minut).toFixed(1)

const zapatiTisku = (m: ExportMesice) => `&L${textTisku(`Vytvořeno ${m.vytvoreno}`)}&RStrana &P z &N`

/**
 * Sešit: „Rozpis“ (dny v řádcích, lidé ve sloupcích, jedna stránka A4 na
 * výšku; při hodně lidech „Rozpis 1“, „Rozpis 2“…) a „Souhrn“ (hodiny po
 * lidech). Hodiny jsou čísla, dají se sčítat.
 */
export function listyXlsx(m: ExportMesice): ListXlsx[] {
  return [...rozpisXlsx(m), souhrnXlsx(m)]
}

function rozpisXlsx(m: ExportMesice): ListXlsx[] {
  const sirka = sirkaSloupceXlsx(m.sloupce)
  /*
    Kdo je na kterém listu, se rozhoduje jednou pro Excel i PDF. Sešit si to
    nepočítá sám — dřív z týchž dat vyšlo v PDF jedna stránka a v sešitu dva
    listy, protože každý měřil šířku po svém a Excel neznal výšku.
  */
  const { casti, lomiMesic } = vyberRozlozeni(m)
  /*
    Zbude-li na stránce místo, sloupce lidí se roztáhnou. Úzký proužek na
    levé třetině A4 nikomu neposlouží a v širším sloupci se navíc vejde
    jméno naležato, takže se nemusí otáčet. Když se měsíc láme na další
    stránku (písmo je už na nejmenším), nic se neroztahuje: list by se jinak
    vytiskl velkým písmem a stránek by bylo víc než v PDF.
  */
  const naSirku = (pocet: number) =>
    lomiMesic
      ? sirka
      : Math.max(sirka, Math.min(NEJSIRSI_SLOUPEC, (TISK_SIRKA_PX - (SIRKA_DNE_XLSX * 7 + 5)) / Math.max(1, pocet) / 7 - 5 / 7))

  const zkratkaPobocky = new Map(m.pobocky.map((p) => [p.nazev, p.zkratka]))

  return casti.map((cast, i) => {
    const sirkaSloupce = naSirku(cast.length)
    // Pobočka pod časem: celý název, když se do sloupce vejde (drobným písmem), jinak zkratka.
    const textPobocky = (nazev: string) =>
      sirkaTextu(nazev, PISMO_DROBNE_XLSX) + VZDUCH_BUNKY_PT <= sirkaSloupceVBodech(sirkaSloupce) ? nazev : (zkratkaPobocky.get(nazev) ?? nazev)
    const radky: (BunkaXlsx | null)[][] = []
    const vyskyRadku: Record<number, number> = {}
    const pridej = (radek: (BunkaXlsx | null)[], vyska: number) => {
      radky.push(radek)
      vyskyRadku[radky.length] = vyska
    }

    pridej([s(casti.length > 1 ? `${m.nadpis} — část ${i + 1} z ${casti.length}` : m.nadpis, STYL.titul)], 22)
    pridej([s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)], 15)

    /*
      Záhlaví: jméno a pod ním pozice. Vejdou-li se do sloupce naležato (po
      slovech, nejvýš tři řádky), nic se neotáčí — vodorovné jméno se čte samo
      a řádek je nižší (Šéfík 20. 9. 2026). Jinak se celé záhlaví otočí o 90°,
      aby sloupec mohl zůstat úzký. Buď otočené celé, nebo nic; půlka tak
      a půlka onak vypadá rozbitě.
    */
    /*
      Šířka se měří v bodech, ne ve znacích — počet znaků lže, protože „í“ je
      užší než „M“. Týmž metrem měří i PDF; odpověď se ale lišit může, a je to
      tak správně: sešit má sloupce pevně široké a před tiskem se celý zmenší
      (jméno se zmenší s ním), kdežto PDF dělí šířku stránky mezi sloupce
      a písmo drží. Každý se proto ptá na svou geometrii.
    */
    const dovnitr = sirkaSloupceVBodech(sirkaSloupce) - 5
    const vejdeSe = (t: string) => sirkaTextu(t, PISMO_ZAHLAVI_XLSX, 'tucne') <= dovnitr
    const vodorovne = jmenaNalezato(cast, vejdeSe)
    const radkuZahlavi = vodorovne
      ? Math.max(
          1,
          ...cast.map(
            (c) =>
              (radkyDoSirky(c.jmeno, vejdeSe)?.length ?? 1) + (c.pozice ? (radkyDoSirky(c.pozice, vejdeSe)?.length ?? 1) : 0),
          ),
        )
      : 0
    const nejdelsi = Math.max(4, ...cast.map((c) => Math.max([...c.jmeno].length, [...c.pozice].length)))
    pridej(
      [
        s('Den', STYL.hlavicka),
        ...cast.map((c) =>
          s(c.pozice ? `${c.jmeno}\n${c.pozice}` : c.jmeno, vodorovne ? STYL.hlavickaJmeno : STYL.hlavickaOtocena),
        ),
      ],
      vodorovne ? Math.max(24, radkuZahlavi * 12 + 6) : Math.min(130, Math.max(50, nejdelsi * 5 + 8)),
    )

    for (const den of m.dny) {
      const vikend = jeVikend(den)
      const bunky = cast.map((c) => radkySmeny(c.podleDne.get(den) ?? [], m.vicePobocek ? textPobocky : undefined))
      const vyska = Math.max(
        VYSKA_RADKU_XLSX + 3,
        ...bunky.map((r) => r.reduce((k, x) => k + (x.drobne ? VYSKA_DROBNE_XLSX : VYSKA_RADKU_XLSX), 3)),
      )
      pridej(
        [
          s(popisDne(den), vikend ? STYL.denRadekVikend : STYL.denRadek),
          ...bunky.map(
            (r): BunkaXlsx => ({
              t: 's',
              v: r.map((x) => x.text).join('\n'),
              s: vikend ? STYL.bunkaVikend : STYL.bunka,
              drobne: r.map((x) => x.drobne),
            }),
          ),
        ],
        vyska,
      )
    }

    pridej(
      [
        s('Hodin', STYL.souctovyText),
        ...cast.map((c) => (c.minut > 0 ? n(hodinyCislem(c.minut), STYL.cisloTucneMale) : s('—', STYL.cisloTucneMale))),
      ],
      18,
    )

    // Poznámky: jen zkratky poboček, které tenhle list opravdu použil.
    const pouziteNazvy = new Set<string>()
    if (m.vicePobocek) {
      for (const c of cast) for (const dily of c.podleDne.values()) for (const d of dily) if (d.pobocka) pouziteNazvy.add(d.pobocka)
    }
    const pouziteZkratky = m.pobocky.filter((p) => pouziteNazvy.has(p.nazev) && textPobocky(p.nazev) !== p.nazev)
    const maxZnaku = Math.floor((SIRKA_DNE_XLSX + cast.length * sirkaSloupce) / 0.85)
    radky.push([])
    for (const radek of zalomitVety(
      vetyPoznamky(m, pouziteZkratky, cast.some((c) => c.osobaId === null)),
      (t) => t.length <= maxZnaku,
    )) {
      pridej([s(radek, STYL.poznamka)], 13)
    }

    return {
      nazev: casti.length > 1 ? `Rozpis ${i + 1}` : 'Rozpis',
      sloupce: [SIRKA_DNE_XLSX, ...cast.map(() => sirkaSloupce)],
      radky,
      vyskyRadku,
      zmrazit: { radky: 3, sloupce: 1 },
      naSirku: false,
      // Celý měsíc na jednu stránku; láme-li se i v PDF, láme se i tady a záhlaví se opakuje.
      naJednuStranku: !lomiMesic,
      opakovatRadky: lomiMesic ? 3 : undefined,
      tisk: { zapati: zapatiTisku(m) },
    }
  })
}

function souhrnXlsx(m: ExportMesice): ListXlsx {
  return {
    nazev: 'Souhrn',
    sloupce: [28, 22, 9, 10],
    radky: [
      [s(`Souhrn hodin — ${nazevMesice(m.mesic)}`, STYL.titul)],
      [s(`${m.rozsah} · vytvořeno ${m.vytvoreno}`, STYL.poznamka)],
      [],
      [s('Zaměstnanec', STYL.hlavicka), s('Pozice', STYL.hlavicka), s('Směn', STYL.hlavicka), s('Hodin', STYL.hlavicka)],
      ...m.souhrn.map((r) => [
        s(r.jmeno, STYL.jmeno),
        s(r.pozice, STYL.jmeno),
        n(r.smen, STYL.cislo),
        n(hodinyCislem(r.minut), STYL.cislo),
      ]),
      [
        s('Celkem', STYL.souctovyText),
        s('', STYL.souctovyText),
        n(m.souhrn.reduce((k, r) => k + r.smen, 0), STYL.cisloTucne),
        n(hodinyCislem(m.celkemMinut), STYL.cisloTucne),
      ],
    ],
    zmrazit: { radky: 4, sloupce: 0 },
    vyskyRadku: { 1: 22 },
    naSirku: false,
    tisk: { zapati: zapatiTisku(m) },
  }
}
