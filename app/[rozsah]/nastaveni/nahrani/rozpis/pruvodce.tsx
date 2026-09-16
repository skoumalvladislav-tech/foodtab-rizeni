'use client'

import { useId, useState, useTransition } from 'react'
import Link from 'next/link'

import { klicDb, precistCsv, zTabulky, type Tabulka } from '@/lib/tabulka'
import { precistXlsx, SouborNecitelny } from '@/lib/xlsx'
import {
  NEJVIC_RADKU,
  odhadnoutMapovani,
  POLE,
  type Mapovani,
  type Plan,
} from '@/lib/nahrani-rozpisu'
import {
  distinctZnacky,
  jeMaticovyFormat,
  NAZVY_MESICU,
  rozeberMatici,
  sestavDatum,
  sloupceJmen,
  type BunkaMatice,
} from '@/lib/nahrani-rozpisu-matice'
import { nabidnoutSablony, type NabidnutaSablona } from '@/app/[rozsah]/smeny/sablony'
import { vytvoritSablonu } from '@/app/[rozsah]/nastaveni/sablony/akce'
import { nactiZamestnance, nahratRozpis, pripravitNahled, type Vysledek, type ZamestnanecSDomovem } from './akce'

/**
 * Průvodce nahráním rozpisu z tabulky.
 *
 * Stejná stavba a stejné pořadí kroků jako ../lide/pruvodce.tsx —
 * zadání (docs/nahravani-dat-zadani.md, oddíl B) platí pro obojí
 * stejně: soubor → přiřazení sloupců → NÁHLED → potvrzení. Náhled se
 * nepřeskakuje ani „když je to jasné“.
 *
 * Soubor se čte tady, v prohlížeči, a na server se posílají jen buňky
 * a přiřazení sloupců. Nikam se neukládá.
 *
 * ---------------------------------------------------------------------
 * DRUHÝ TVAR TABULKY — MATICE (dny v řádcích, jména ve sloupcích)
 *
 * Šéfík 16.9.2026 (chat): reálný export rozpisu bývá matice se
 * značkami (R/O/X, „-B“/„-P“ pro pobočku), ne řádek na směnu s časy.
 * Krok „soubor“ pozná tvar sám (lib/nahrani-rozpisu-matice.ts) a místo
 * kroku „sloupce“ (ten pro matici nedává smysl — nejde přiřazovat
 * sloupce, tvar je pevný) jde do nového kroku „značky“: měsíc/rok,
 * které pobočce patří která přípona, a časy pro značky, které appka
 * ještě nezná (rovnou navrhne, uloží se do Šablon směn, dá se upravit
 * později). Teprve pak se rozloží do stejného tvaru, jaký čeká
 * `sestavPlan` — jedna diffovací logika pro oba vstupy, ne dvě.
 */

type Krok = 'soubor' | 'sloupce' | 'znacky' | 'nahled' | 'hotovo'

/** Časy, které appka sama navrhne pro obecně známé značky (R/O/X) — dál se upravují v Šablonách směn. */
const VYCHOZI_CASY: Record<string, { od: string; do: string }> = {
  R: { od: '08:00', do: '16:00' },
  O: { od: '14:00', do: '22:00' },
  X: { od: '08:00', do: '22:00' },
}

export default function Pruvodce({
  rozsah,
  pobocky = [],
}: {
  rozsah: string
  /** Pro krok "značky" — komu se má přiřadit přípona jako „-B“. Nepovinné: bez toho matice nabídne jen výchozí pobočku. */
  pobocky?: { id: string; nazev: string }[]
}) {
  const idSouboru = useId()
  const [krok, setKrok] = useState<Krok>('soubor')
  const [nazevSouboru, setNazevSouboru] = useState('')
  const [tabulka, setTabulka] = useState<Tabulka | null>(null)
  const [mapovani, setMapovani] = useState<Mapovani>({})
  const [plan, setPlan] = useState<Plan | null>(null)
  const [hotovo, setHotovo] = useState<Extract<Vysledek, { stav: 'hotovo' }> | null>(null)
  const [chyba, setChyba] = useState('')
  const [ceka, spust] = useTransition()

  /* --- stav kroku "značky" (jen pro maticový vstup) ---------------- */
  const [jeMatice, setJeMatice] = useState(false)
  const ted = new Date()
  const [rok, setRok] = useState(ted.getFullYear())
  const [mesic, setMesic] = useState(ted.getMonth() + 1)
  const [mapaPripon, setMapaPripon] = useState<Record<string, string>>({})
  const [casyZnacek, setCasyZnacek] = useState<Record<string, { od: string; do: string }>>({})
  const [chybejiciZnacky, setChybejiciZnacky] = useState<{ zaklad: string; branchId: string; nazevPobocky: string }[] | null>(null)
  const [chybyVytvareni, setChybyVytvareni] = useState<string[]>([])
  const [zamestnanci, setZamestnanci] = useState<ZamestnanecSDomovem[]>([])

  async function vybranSoubor(e: React.ChangeEvent<HTMLInputElement>) {
    const soubor = e.target.files?.[0]
    if (!soubor) return
    setChyba('')
    try {
      const t = await precistSoubor(soubor)
      if (t.hlavicka.length === 0) {
        setChyba('V souboru se nenašla žádná tabulka.')
        return
      }
      if (t.radky.length === 0) {
        setChyba('Soubor má jen záhlaví, žádné řádky s rozpisem.')
        return
      }
      setNazevSouboru(soubor.name)
      setTabulka(t)
      if (jeMaticovyFormat(t.hlavicka, t.radky)) {
        setJeMatice(true)
        setKrok('znacky')
        // Domovské pobočky a pozice — viz komentář u `najdiZamestnance` níž.
        nactiZamestnance(rozsah).then(setZamestnanci)
      } else {
        setJeMatice(false)
        setMapovani(odhadnoutMapovani(t.hlavicka))
        setKrok('sloupce')
      }
    } catch (e) {
      setChyba(
        e instanceof SouborNecitelny
          ? `${e.message} Zkuste soubor uložit jako CSV.`
          : 'Soubor se nepodařilo přečíst. Podporujeme CSV a .xlsx.',
      )
    }
  }

  function naNahled() {
    if (!tabulka) return
    setChyba('')
    spust(async () => {
      const v = await pripravitNahled({
        rozsah,
        radky: tabulka.radky,
        mapovani,
        soubor: nazevSouboru,
      })
      if (v.stav === 'chyba') setChyba(v.text)
      else if (v.stav === 'plan') {
        setPlan(v.plan)
        setKrok('nahled')
      }
    })
  }

  /* --- krok "značky" (jen maticový vstup) -------------------------- */

  /** Které přípony (pobočky) je potřeba přiřadit — '' = buňky bez přípony. */
  /*
    Zaměstnanec už domovskou pobočku a pozici MÁ (employees.branch_id/
    position_id) — Šéfík 16.9.2026: "mělo by se to automaticky rozlišit
    dle jména". Buňka bez přípony ("X" bez "-B"/"-P") proto NENÍ
    nejednoznačná: patří tomu, kdo tu směnu má, na JEHO pobočce
    a pozici. Přípona je jen výjimka (výpomoc na druhé pobočce), ne
    pravidlo pro každého — jen ONA se ptá uživatele, kterou pobočku
    znamená.
  */
  function najdiZamestnance(jmeno: string): ZamestnanecSDomovem | undefined {
    return zamestnanci.find((z) => klicDb(z.jmeno) === klicDb(jmeno))
  }

  /** Které PŘÍPONY (ne buňky bez přípony — ty řeší domovská pobočka) je potřeba přiřadit pobočce. */
  function potrebnePripony(bunky: BunkaMatice[]): string[] {
    return [...new Set(bunky.map((b) => b.pripona).filter((p): p is string => p !== null))].sort()
  }

  type DvojiceZnacky = { zaklad: string; branchId: string | null; positionId: string | null }

  /** Pobočka a pozice pro každou buňku — z přípony (výjimka) nebo z domovské pobočky/pozice zaměstnance (pravidlo). */
  function dvojiceProBunky(bunky: BunkaMatice[]): DvojiceZnacky[] {
    return bunky.map((b) => {
      const z = najdiZamestnance(b.jmeno)
      const branchId = b.pripona ? (mapaPripon[b.pripona] ?? null) : (z?.branchId ?? null)
      return { zaklad: b.zaklad, branchId, positionId: z?.positionId ?? null }
    })
  }

  /**
   * Zeptá se Šablon směn (`nabidnoutSablony`), co appka o dvojicích
   * (zaklad, pobočka) ví. Schválně BEZ pozice — auto-vytvořené šablony
   * jsou vždycky pobočkové, ne pozicové (viz `vytvoritZnackyAPokracovat`
   * níž), takže hledání podle pozice by tu jen komplikovalo klíč beze
   * zisku. Pozice se dál nese zvlášť a zapisuje se přímo na směnu.
   */
  async function zjistiCasyZnacek(
    dvojice: DvojiceZnacky[],
  ): Promise<{
    nalezene: Record<string, { od: string; do: string }>
    chybejici: { zaklad: string; branchId: string; nazevPobocky: string }[]
  }> {
    const platne = dvojice.filter((d): d is DvojiceZnacky & { branchId: string } => d.branchId !== null)
    const branchIds = [...new Set(platne.map((d) => d.branchId))]
    const nabidkaPodlePobocky = new Map<string, NabidnutaSablona[]>()
    for (const bid of branchIds) {
      nabidkaPodlePobocky.set(bid, await nabidnoutSablony(rozsah, bid, null))
    }
    const nalezene: Record<string, { od: string; do: string }> = {}
    const chybejici: { zaklad: string; branchId: string; nazevPobocky: string }[] = []
    for (const { zaklad, branchId } of platne) {
      const klicMapy = `${zaklad}|${branchId}`
      if (nalezene[klicMapy] || chybejici.some((c) => `${c.zaklad}|${c.branchId}` === klicMapy)) continue
      const nabidka = nabidkaPodlePobocky.get(branchId) ?? []
      const nalezena = nabidka.find((s) => s.klic.toLowerCase() === zaklad.toLowerCase())
      if (nalezena) {
        nalezene[klicMapy] = { od: nalezena.od, do: nalezena.do }
      } else {
        chybejici.push({ zaklad, branchId, nazevPobocky: pobocky.find((p) => p.id === branchId)?.nazev ?? 'pobočka' })
      }
    }
    return { nalezene, chybejici }
  }

  /** Poslední krok maticového vstupu: rozloží buňky do stejného tvaru, jaký čeká `sestavPlan`, a rovnou zeptá na náhled. */
  async function dokoncitMatici(
    bunky: BunkaMatice[],
    dvojice: DvojiceZnacky[],
    casy: Record<string, { od: string; do: string }>,
  ) {
    const virtualniRadky: string[][] = []
    const nedoplnene: string[] = []
    bunky.forEach((b, i) => {
      const { branchId, positionId } = dvojice[i]
      const datum = sestavDatum(rok, mesic, b.den)
      if (!datum) {
        nedoplnene.push(`${b.jmeno}, den ${b.den}: v tomhle měsíci takový den není`)
        return
      }
      if (!branchId) {
        nedoplnene.push(
          b.pripona
            ? `${b.jmeno}, ${datum}: přípona „${b.pripona}“ nemá přiřazenou pobočku`
            : `${b.jmeno}, ${datum}: nemá domovskou pobočku v Nastavení → Lidé a buňka nemá příponu — doplňte jedno z toho`,
        )
        return
      }
      const nazevPobocky = pobocky.find((p) => p.id === branchId)?.nazev ?? ''
      const cas = casy[`${b.zaklad}|${branchId}`]
      if (!cas) {
        nedoplnene.push(`${b.jmeno}, ${datum}: zkratka „${b.kodRaw}“ se nepodařilo přiřadit`)
        return
      }
      virtualniRadky.push([b.jmeno, nazevPobocky, datum, cas.od, cas.do, b.zaklad, positionId ?? ''])
    })

    if (virtualniRadky.length === 0) {
      setChyba(
        'Po rozpoznání značek nezůstal žádný řádek k nahrání.' +
          (nedoplnene.length > 0 ? ' ' + nedoplnene.slice(0, 5).join('; ') : ''),
      )
      return
    }

    const mapovaniMatice: Mapovani = { jmeno: 0, pobocka: 1, datum: 2, zacatek: 3, konec: 4, kod: 5, pozice_id: 6 }
    setTabulka({ hlavicka: ['Jméno', 'Pobočka', 'Datum', 'Začátek', 'Konec', 'Kód', 'Pozice'], radky: virtualniRadky })
    setMapovani(mapovaniMatice)
    setChybejiciZnacky(null)

    const v = await pripravitNahled({ rozsah, radky: virtualniRadky, mapovani: mapovaniMatice, soubor: nazevSouboru })
    if (v.stav === 'chyba') {
      setChyba(nedoplnene.length > 0 ? `${v.text} (${nedoplnene.slice(0, 5).join('; ')})` : v.text)
    } else if (v.stav === 'plan') {
      setPlan(v.plan)
      setKrok('nahled')
      if (nedoplnene.length > 0) {
        setChyba(`${nedoplnene.length} buněk se nepodařilo rozpoznat a chybí v plánu níž: ${nedoplnene.slice(0, 5).join('; ')}`)
      }
    }
  }

  /** Tlačítko "Ukázat, co se stane" v kroku "značky". */
  function pokracovatZeZnacek() {
    if (!tabulka) return
    setChyba('')
    setChybyVytvareni([])
    const sloupce = sloupceJmen(tabulka.hlavicka)
    const bunky = rozeberMatici(tabulka.radky, sloupce)
    if (bunky.length === 0) {
      setChyba('V souboru se nenašla žádná rozpoznatelná buňka se směnou — zkontrolujte, že první sloupec obsahuje den v měsíci (1–31).')
      return
    }
    for (const p of potrebnePripony(bunky)) {
      if (!mapaPripon[p]) {
        setChyba(`Vyberte pobočku pro příponu „${p}“.`)
        return
      }
    }
    const dvojice = dvojiceProBunky(bunky)
    spust(async () => {
      const { nalezene, chybejici } = await zjistiCasyZnacek(dvojice)
      if (chybejici.length === 0) {
        await dokoncitMatici(bunky, dvojice, nalezene)
        return
      }
      setChybejiciZnacky(chybejici)
      setCasyZnacek((c) => {
        const doplnene = { ...c, ...nalezene }
        for (const ch of chybejici) {
          const klicMapy = `${ch.zaklad}|${ch.branchId}`
          if (!doplnene[klicMapy]) {
            const navrh = VYCHOZI_CASY[ch.zaklad.toUpperCase()]
            if (navrh) doplnene[klicMapy] = navrh
          }
        }
        return doplnene
      })
    })
  }

  /** Tlačítko "Vytvořit značky a pokračovat" — jen když `chybejiciZnacky` není prázdné. */
  function vytvoritZnackyAPokracovat() {
    if (!tabulka || !chybejiciZnacky) return
    setChybyVytvareni([])
    spust(async () => {
      const chyby: string[] = []
      const nove: Record<string, { od: string; do: string }> = {}
      for (const ch of chybejiciZnacky) {
        const klicMapy = `${ch.zaklad}|${ch.branchId}`
        const cas = casyZnacek[klicMapy]
        if (!cas || !cas.od || !cas.do) {
          chyby.push(`Zkratka „${ch.zaklad}“ (${ch.nazevPobocky}): vyplňte čas od–do.`)
          continue
        }
        const vysledek = await vytvoritSablonu({
          rozsah,
          klic: ch.zaklad,
          nazev: `${ch.zaklad} (z dovozu rozpisu)`,
          pobocka: ch.branchId,
          od: cas.od,
          do: cas.do,
        })
        if (vysledek.stav === 'chyba') {
          chyby.push(`Zkratka „${ch.zaklad}“ (${ch.nazevPobocky}): ${vysledek.text}`)
        } else {
          nove[klicMapy] = cas
        }
      }
      if (chyby.length > 0) {
        setChybyVytvareni(chyby)
        return
      }
      const sloupce = sloupceJmen(tabulka.hlavicka)
      const bunky = rozeberMatici(tabulka.radky, sloupce)
      const dvojice = dvojiceProBunky(bunky)
      await dokoncitMatici(bunky, dvojice, { ...casyZnacek, ...nove })
    })
  }

  function potvrdit() {
    if (!tabulka) return
    setChyba('')
    spust(async () => {
      const v = await nahratRozpis({
        rozsah,
        radky: tabulka.radky,
        mapovani,
        soubor: nazevSouboru,
      })
      if (v.stav === 'chyba') setChyba(v.text)
      else if (v.stav === 'hotovo') {
        setHotovo(v)
        setKrok('hotovo')
      }
    })
  }

  function znovu() {
    setKrok('soubor')
    setTabulka(null)
    setPlan(null)
    setHotovo(null)
    setChyba('')
    setNazevSouboru('')
    setJeMatice(false)
    setMapaPripon({})
    setCasyZnacek({})
    setChybejiciZnacky(null)
    setChybyVytvareni([])
    setZamestnanci([])
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '32px' }}>
      <Kroky krok={krok} maticovy={jeMatice} />

      {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

      {krok === 'soubor' ? (
        <div style={karta}>
          <h2 style={nadpisKarty}>Vyberte soubor</h2>
          <p style={popis}>
            Tabulka rozpisu z Excelu (.xlsx) nebo CSV — sloupce se jménem,
            datem, začátkem a koncem směny. Nezáleží na pořadí sloupců ani
            na tom, jak se jmenují — v dalším kroku je přiřadíte. Soubor
            zůstane u vás v počítači; posílají se jen přečtené buňky.
          </p>
          {/*
            Nabarvený label místo holého <input type=file>. Prohlížeč
            kreslí nestylované tlačítko souboru jako malé šedé "Vybrat
            soubor" — vedle zbytku appky to vypadalo rozbitě/needitovatelně
            (nahlásil Šéfík 16.9.2026 jako "špatně zvýrazněné", zaměnitelné
            za nefunkční). Input zůstává v DOM a funkční (napojený přes
            `htmlFor`/`id`), jen vizuálně schovaný — klávesnice i
            odečítač na něj dosáhnou stejně jako předtím.
          */}
          <label htmlFor={idSouboru} className="ft-tl ft-tl-vedlejsi" style={{ cursor: 'pointer' }}>
            Vybrat soubor
          </label>
          <input
            id={idSouboru}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={vybranSoubor}
            className="ft-jen-pro-odecitac"
          />
          <p style={{ ...popis, marginBottom: 0 }}>
            Najednou jde nahrát nejvýš {NEJVIC_RADKU} řádků. Nahrání jde
            pustit i vícekrát — směna, která už je zapsaná (podle člověka,
            data a pobočky), se pozná a nezdvojí. Jméno musí sedět na
            existujícího zaměstnance — nové lidi nahrajte nejdřív přes{' '}
            <Link href={`/${rozsah}/nastaveni/nahrani/lide`}>Nahrání dat → Lidé</Link>.
          </p>
        </div>
      ) : null}

      {krok === 'sloupce' && tabulka ? (
        <>
          <div style={karta}>
            <h2 style={nadpisKarty}>Co je ve kterém sloupci</h2>
            <p style={popis}>
              Soubor <strong>{nazevSouboru}</strong> — {tabulka.radky.length}{' '}
              {tabulka.radky.length === 1 ? 'řádek' : tabulka.radky.length < 5 ? 'řádky' : 'řádků'}.
              Co aplikace odhadla, opravte.
            </p>

            <div style={{ display: 'grid', gap: '12px', maxWidth: '640px' }}>
              {POLE.map((pole) => (
                <label key={pole.klic} style={radekPole}>
                  <span style={{ fontWeight: 600 }}>
                    {pole.nazev}
                    {pole.povinne ? ' *' : ''}
                    <span style={{ display: 'block', fontWeight: 400, fontSize: '12.5px', color: 'var(--muted)' }}>
                      {pole.napoveda}
                    </span>
                  </span>
                  <select
                    value={mapovani[pole.klic] ?? ''}
                    onChange={(e) =>
                      setMapovani((m) => {
                        const n = { ...m }
                        if (e.target.value === '') delete n[pole.klic]
                        else n[pole.klic] = Number(e.target.value)
                        return n
                      })
                    }
                    style={vyber}
                  >
                    <option value="">— nepřiřazeno —</option>
                    {tabulka.hlavicka.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `sloupec ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div style={karta}>
            <h2 style={nadpisKarty}>Prvních pár řádků ze souboru</h2>
            <Nahlizecka tabulka={tabulka} />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ft-tl ft-tl-hlavni"
              onClick={naNahled}
              disabled={
                ceka ||
                mapovani.jmeno === undefined ||
                mapovani.datum === undefined ||
                mapovani.zacatek === undefined ||
                mapovani.konec === undefined
              }
            >
              {ceka ? 'Počítám…' : 'Ukázat, co se stane'}
            </button>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={znovu}>
              Jiný soubor
            </button>
          </div>
          {mapovani.jmeno === undefined ||
          mapovani.datum === undefined ||
          mapovani.zacatek === undefined ||
          mapovani.konec === undefined ? (
            <p style={{ ...popis, marginTop: '10px' }}>
              Jméno, datum, začátek a konec jsou povinné — bez nich se
              směna nedá založit ani poznat.
            </p>
          ) : null}
        </>
      ) : null}

      {krok === 'znacky' && tabulka ? (
        <ZnackyKrok
          tabulka={tabulka}
          nazevSouboru={nazevSouboru}
          pobocky={pobocky}
          rok={rok}
          setRok={setRok}
          mesic={mesic}
          setMesic={setMesic}
          mapaPripon={mapaPripon}
          setMapaPripon={setMapaPripon}
          chybejiciZnacky={chybejiciZnacky}
          casyZnacek={casyZnacek}
          setCasyZnacek={setCasyZnacek}
          chybyVytvareni={chybyVytvareni}
          ceka={ceka}
          onPokracovat={pokracovatZeZnacek}
          onVytvoritAPokracovat={vytvoritZnackyAPokracovat}
          onJinySoubor={znovu}
        />
      ) : null}

      {krok === 'nahled' && plan ? (
        <>
          <div style={karta}>
            <h2 style={nadpisKarty}>Co se stane</h2>
            <p style={{ fontSize: '17px', margin: '0 0 4px' }}>
              Založí se <strong>{plan.zalozit}</strong>, aktualizuje{' '}
              <strong>{plan.aktualizovat}</strong>, přeskočí{' '}
              <strong>{plan.preskocit}</strong>
              {plan.bezeZmeny > 0 ? (
                <>
                  {' '}
                  a <strong>{plan.bezeZmeny}</strong> zůstane beze změny
                </>
              ) : null}
              .
            </p>
            <p style={{ ...popis, marginBottom: 0 }}>
              Zatím se nic nezměnilo. Zapisuje se až po potvrzení.
            </p>
          </div>

          <div style={karta}>
            <h2 style={nadpisKarty}>Řádek po řádku</h2>
            <Vypis plan={plan} />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ft-tl ft-tl-hlavni"
              onClick={potvrdit}
              disabled={ceka || plan.zalozit + plan.aktualizovat === 0}
            >
              {ceka ? 'Nahrávám…' : 'Potvrdit a nahrát'}
            </button>
            <button
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => setKrok('sloupce')}
              disabled={ceka}
            >
              Zpět k sloupcům
            </button>
          </div>
          {plan.zalozit + plan.aktualizovat === 0 ? (
            <p style={{ ...popis, marginTop: '10px' }}>
              Není co nahrát — všechno už je v rozpisu stejně, nebo se
              nedá přečíst.
            </p>
          ) : null}
        </>
      ) : null}

      {krok === 'hotovo' && hotovo ? (
        <div style={karta}>
          <h2 style={nadpisKarty}>Hotovo</h2>
          <p style={{ fontSize: '17px', margin: '0 0 8px' }}>
            Založeno <strong>{hotovo.zalozeno}</strong>, aktualizováno{' '}
            <strong>{hotovo.aktualizovano}</strong>, přeskočeno{' '}
            <strong>{hotovo.preskoceno}</strong>.
          </p>

          {hotovo.chyby.length > 0 ? (
            <>
              <p className="hlaska-chyba">
                {hotovo.chyby.length} {hotovo.chyby.length === 1 ? 'řádek' : 'řádků'} se
                nenahrálo. Pusťte nahrání znovu — co je uvnitř, se nezdvojí.
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: '18px', fontSize: '13px' }}>
                {hotovo.chyby.slice(0, 10).map((c, i) => (
                  <li key={i}>
                    {c.cislo > 0 ? `Řádek ${c.cislo} (${c.jmeno}): ` : ''}
                    {c.text}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link href={`/${rozsah}/smeny`} className="ft-tl ft-tl-hlavni">
              Na rozpis směn
            </Link>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={znovu}>
              Nahrát další soubor
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* --- části obrazovky ---------------------------------------------- */

const NAZVY_KROKU_PLOCHY: { klic: Krok; nazev: string }[] = [
  { klic: 'soubor', nazev: 'Soubor' },
  { klic: 'sloupce', nazev: 'Sloupce' },
  { klic: 'nahled', nazev: 'Náhled' },
  { klic: 'hotovo', nazev: 'Potvrzení' },
]

const NAZVY_KROKU_MATICE: { klic: Krok; nazev: string }[] = [
  { klic: 'soubor', nazev: 'Soubor' },
  { klic: 'znacky', nazev: 'Značky' },
  { klic: 'nahled', nazev: 'Náhled' },
  { klic: 'hotovo', nazev: 'Potvrzení' },
]

function Kroky({ krok, maticovy }: { krok: Krok; maticovy: boolean }) {
  const NAZVY_KROKU = maticovy ? NAZVY_KROKU_MATICE : NAZVY_KROKU_PLOCHY
  const kde = NAZVY_KROKU.findIndex((k) => k.klic === krok)
  return (
    <ol
      style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        listStyle: 'none',
        margin: '0 0 16px',
        padding: 0,
        fontSize: '13px',
      }}
    >
      {NAZVY_KROKU.map((k, i) => (
        <li
          key={k.klic}
          aria-current={i === kde ? 'step' : undefined}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--line)',
            background: i === kde ? 'var(--mosaz-sv)' : 'transparent',
            color: i === kde ? '#17251e' : i < kde ? 'var(--ink)' : 'var(--muted)',
            fontWeight: i === kde ? 700 : 400,
          }}
        >
          {i + 1}. {k.nazev}
        </li>
      ))}
    </ol>
  )
}

/**
 * Krok "Značky" — jen pro maticový vstup (dny v řádcích, jména ve
 * sloupcích). Měsíc/rok, komu patří která přípona (pobočka), a pro
 * zkratky, které appka ještě nezná, návrh času k potvrzení.
 */
function ZnackyKrok({
  tabulka,
  nazevSouboru,
  pobocky,
  rok,
  setRok,
  mesic,
  setMesic,
  mapaPripon,
  setMapaPripon,
  chybejiciZnacky,
  casyZnacek,
  setCasyZnacek,
  chybyVytvareni,
  ceka,
  onPokracovat,
  onVytvoritAPokracovat,
  onJinySoubor,
}: {
  tabulka: Tabulka
  nazevSouboru: string
  pobocky: { id: string; nazev: string }[]
  rok: number
  setRok: (r: number) => void
  mesic: number
  setMesic: (m: number) => void
  mapaPripon: Record<string, string>
  setMapaPripon: (f: (m: Record<string, string>) => Record<string, string>) => void
  chybejiciZnacky: { zaklad: string; branchId: string; nazevPobocky: string }[] | null
  casyZnacek: Record<string, { od: string; do: string }>
  setCasyZnacek: (f: (c: Record<string, { od: string; do: string }>) => Record<string, { od: string; do: string }>) => void
  chybyVytvareni: string[]
  ceka: boolean
  onPokracovat: () => void
  onVytvoritAPokracovat: () => void
  onJinySoubor: () => void
}) {
  const sloupce = sloupceJmen(tabulka.hlavicka)
  const bunky = rozeberMatici(tabulka.radky, sloupce)
  const { pripony } = distinctZnacky(bunky)

  return (
    <>
      <div style={karta}>
        <h2 style={nadpisKarty}>Rozpoznána tabulka s dny v řádcích a jmény ve sloupcích</h2>
        <p style={popis}>
          Soubor <strong>{nazevSouboru}</strong> — {sloupce.length}{' '}
          {sloupce.length === 1 ? 'sloupec se jménem' : 'sloupců se jmény'}, {bunky.length}{' '}
          {bunky.length === 1 ? 'buňka se směnou' : 'buněk se směnou'}. Appka tenhle tvar pozná
          podle prvního sloupce — den v měsíci (1–31) — a zbylých sloupců se jmény lidí.
        </p>

        <div style={dvaSloupce}>
          <label style={poleSvisle}>
            <span style={{ fontWeight: 600 }}>Měsíc</span>
            <select value={mesic} onChange={(e) => setMesic(Number(e.target.value))} style={vyber}>
              {NAZVY_MESICU.map((n, i) => (
                <option key={i} value={i + 1}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label style={poleSvisle}>
            <span style={{ fontWeight: 600 }}>Rok</span>
            <input
              type="number"
              value={rok}
              onChange={(e) => setRok(Number(e.target.value))}
              style={vyber}
            />
          </label>
        </div>

        {/*
          UX oprava 16.9.2026: dřív appka chtěla pobočku i pro buňky
          BEZ přípony — jeden výběr pro všechny, takže kdo neměl
          příponu, skončil na jedné natvrdo zvolené pobočce bez ohledu
          na to, kde doopravdy pracuje. Teď buňka bez přípony patří na
          DOMOVSKOU pobočku a pozici toho člověka (Nastavení → Lidé) —
          přípona je jen výjimka (výpomoc jinde), proto se ptá appka
          jen na ni.
        */}
        <p style={{ ...popis, margin: '0 0 8px' }}>
          Buňka bez přípony (např. „X“ samotné) jde na domovskou pobočku
          a pozici toho člověka podle Nastavení → Lidé. Přípona pobočku
          přepíše — komu patří která, vyberte tady:
        </p>
        {pripony.length > 0 ? (
          <div style={{ display: 'grid', gap: '10px', maxWidth: '480px' }}>
            {pripony.map((p) => (
              <label key={p} style={radekPole}>
                <span style={{ fontWeight: 600 }}>Přípona „{p}“</span>
                <select
                  value={mapaPripon[p] ?? ''}
                  onChange={(e) =>
                    setMapaPripon((m) => ({ ...m, [p]: e.target.value }))
                  }
                  style={vyber}
                >
                  <option value="">— vyberte pobočku —</option>
                  {pobocky.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nazev}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : (
          <p style={{ ...popis, margin: 0, fontStyle: 'italic' }}>
            Soubor žádné přípony nepoužívá — všechno jde podle domovské pobočky.
          </p>
        )}
      </div>

      <div style={karta}>
        <h2 style={nadpisKarty}>Prvních pár řádků ze souboru</h2>
        <Nahlizecka tabulka={tabulka} />
      </div>

      {chybejiciZnacky && chybejiciZnacky.length > 0 ? (
        <div style={karta}>
          <h2 style={nadpisKarty}>Appka nezná tyhle zkratky</h2>
          <p style={popis}>
            Nejsou v Šablonách směn na dané pobočce ani pro celou firmu. Appka
            navrhne čas u těch, co pozná (R = ranní, O = odpolední, X = celá) —
            u ostatních vyplňte čas sami. Uloží se do Šablon směn, kde je
            kdykoli upravíte — a tímhle dovozem založené směny se dají po
            úpravě přepsat tlačítkem „Přepsat časy do nevydaných směn“.
          </p>
          <div style={{ display: 'grid', gap: '10px' }}>
            {chybejiciZnacky.map((ch) => {
              const klicMapy = `${ch.zaklad}|${ch.branchId}`
              const cas = casyZnacek[klicMapy] ?? { od: '', do: '' }
              return (
                <div key={klicMapy} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, minWidth: '160px' }}>
                    „{ch.zaklad}“ — {ch.nazevPobocky}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    od
                    <input
                      type="time"
                      value={cas.od}
                      onChange={(e) =>
                        setCasyZnacek((c) => ({ ...c, [klicMapy]: { od: e.target.value, do: c[klicMapy]?.do ?? '' } }))
                      }
                      style={{ ...vyber, width: 'auto' }}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                    do
                    <input
                      type="time"
                      value={cas.do}
                      onChange={(e) =>
                        setCasyZnacek((c) => ({ ...c, [klicMapy]: { od: c[klicMapy]?.od ?? '', do: e.target.value } }))
                      }
                      style={{ ...vyber, width: 'auto' }}
                    />
                  </label>
                </div>
              )
            })}
          </div>
          {chybyVytvareni.length > 0 ? (
            <ul style={{ margin: '12px 0 0', paddingLeft: '18px', fontSize: '13px', color: 'var(--bad)' }}>
              {chybyVytvareni.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '14px' }}>
            <button type="button" className="ft-tl ft-tl-hlavni" onClick={onVytvoritAPokracovat} disabled={ceka}>
              {ceka ? 'Ukládám…' : 'Vytvořit značky a pokračovat'}
            </button>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={onJinySoubor}>
              Jiný soubor
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ft-tl ft-tl-hlavni"
            onClick={onPokracovat}
            disabled={ceka || bunky.length === 0}
          >
            {ceka ? 'Počítám…' : 'Ukázat, co se stane'}
          </button>
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={onJinySoubor}>
            Jiný soubor
          </button>
        </div>
      )}
    </>
  )
}

/** Prvních pár řádků tak, jak přišly ze souboru. */
function Nahlizecka({ tabulka }: { tabulka: Tabulka }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '13px', minWidth: '100%' }}>
        <thead>
          <tr>
            {tabulka.hlavicka.map((h, i) => (
              <th key={i} style={{ ...bunka, fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' }}>
                {h || `sloupec ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabulka.radky.slice(0, 5).map((r, i) => (
            <tr key={i}>
              {r.map((b, j) => (
                <td key={j} style={bunka}>
                  {b}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {tabulka.radky.length > 5 ? (
        <p style={{ ...popis, marginBottom: 0 }}>…a dalších {tabulka.radky.length - 5}.</p>
      ) : null}
    </div>
  )
}

const STITKY: Record<string, { text: string; barva: string; pozadi: string }> = {
  zalozit: { text: 'založí se', barva: 'var(--dobre)', pozadi: 'var(--dobre-bg)' },
  aktualizovat: { text: 'aktualizuje', barva: 'var(--pozor)', pozadi: 'var(--pozor-bg)' },
  beze_zmeny: { text: 'beze změny', barva: 'var(--muted)', pozadi: 'transparent' },
  preskocit: { text: 'přeskočí', barva: 'var(--bad)', pozadi: 'var(--bad-bg)' },
}

function Vypis({ plan }: { plan: Plan }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
      {plan.zaznamy.map((z) => {
        const s = STITKY[z.co]
        return (
          <li key={z.cislo} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)', fontSize: '12px', minWidth: '3.2em' }}>
              ř. {z.cislo}
            </span>
            <span
              style={{
                padding: '1px 8px',
                borderRadius: 'var(--radius-full)',
                background: s.pozadi,
                color: s.barva,
                fontSize: '11.5px',
                whiteSpace: 'nowrap',
                border: s.pozadi === 'transparent' ? '1px solid var(--line)' : 'none',
              }}
            >
              {s.text}
            </span>
            <span style={{ fontSize: '14px' }}>
              {z.jmeno || <em style={{ color: 'var(--muted)' }}>bez jména</em>}
              {z.duvod ? <span style={{ color: 'var(--muted)' }}> — {z.duvod}</span> : null}
              {z.zmeny.map((zm, i) => (
                <span key={i} style={{ color: 'var(--muted)' }}>
                  {' '}
                  · {zm.pole}: {zm.z} → {zm.na}
                </span>
              ))}
              {z.poznamky.map((p, i) => (
                <span key={i} style={{ color: 'var(--muted)' }}> · {p}</span>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* --- čtení souboru -------------------------------------------------- */

async function precistSoubor(soubor: File): Promise<Tabulka> {
  const bajty = new Uint8Array(await soubor.arrayBuffer())

  if (bajty[0] === 0x50 && bajty[1] === 0x4b) {
    return zTabulky(await precistXlsx(bajty))
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bajty)
  } catch {
    text = new TextDecoder('windows-1250').decode(bajty)
  }
  return precistCsv(text)
}

/* --- styly ---------------------------------------------------------- */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  marginBottom: '16px',
} as const

const nadpisKarty = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '8px 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '68ch',
} as const

const radekPole = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 220px)',
  gap: '12px',
  alignItems: 'center',
  fontSize: '14px',
} as const

const dvaSloupce = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
  maxWidth: '420px',
  marginBottom: '4px',
} as const

const poleSvisle = {
  display: 'grid',
  gap: '6px',
  fontSize: '14px',
} as const

const vyber = {
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
  width: '100%',
} as const

const bunka = {
  border: '1px solid var(--line)',
  padding: '5px 8px',
  maxWidth: '22ch',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
