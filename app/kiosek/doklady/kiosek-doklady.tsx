'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'

import { datumACasVPasmu } from '@/lib/cas'
import {
  HLASKA_KIOSEK_VYPNUTY,
  KLIC_ZARIZENI_ULOZISTE,
  LIMIT_AKCE_MS,
  LIMIT_NAHRANI_MS,
  nahledyKUvolneni,
  novyKlicPoChybe,
  sLimitem,
  zacinaNovyDoklad,
  type DokladDnes,
} from '@/lib/jine-platby-kiosek'
import { zkontrolovatPoZmenseni, zkontrolovatVyber, zmensitDoklad } from '@/lib/jine-platby-soubory'
import { KBELIK_JINYCH_PLATEB } from '@/lib/jine-platby-typy'
import { hlaskaKiosku } from '@/lib/kiosek-spojeni'
import { getKioskSupabase, getKioskSupabaseNahravani } from '@/lib/supabase/kiosek'

import { dokoncitDoklad, nacistDnesniDoklady, nacistStavKiosku, pripravitDoklad } from './akce'
import ObrazovkaKiosku, { type FotkaNaObrazovce, type StavObrazovky } from './obrazovka'

/**
 * Kiosek Jiných plateb na telefonu pobočky (app/kiosek/doklady/page.tsx).
 *
 * Totožnost dává ZAŘÍZENÍ jako u kiosku Docházky: klíč z registrace
 * (`registrovat_zarizeni_doklady` — telefon jen na doklady, Docházku
 * neumí) v localStorage telefonu pod VLASTNÍM jménem
 * (`KLIC_ZARIZENI_ULOZISTE`, jiné než u tabletu Docházky). Žádný
 * přihlášený člověk, žádný PIN (upřesnění Šéfíka 22. 10.).
 *
 * Klíč se maže JEN tehdy, když databáze výslovně řekne, že zařízení
 * nezná nebo je odvolané (`stav: 'odpojeno'`) — výpadek sítě ani vypnutý
 * kiosek klíč nemažou.
 *
 * Klíč ODESLÁNÍ (`klientId`) drží jeden doklad: opakování po výpadku sítě
 * vrátí týž záznam. Nový vznikne po „Vyfotit další doklad“, když databáze
 * řekne, že doklad je uzavřený (`novyKlicPoChybe`), a když se fotky
 * přidávají do prázdného seznamu nebo k už odeslaným (`zacinaNovyDoklad`).
 */

/** Jak často obnovit přehled dnešních dokladů, když je obrazovka vidět. */
const OBNOVA_PREHLEDU_MS = 60_000

type Fotka = { id: string; soubor: File; nahled: string | null; odeslana: boolean }
type Spojeni =
  | { druh: 'nacitam' }
  | { druh: 'ok'; pobocka: string; zarizeni: string }
  | { druh: 'odpojeno' }
  | { druh: 'vypnuto' }
  | { druh: 'vypadek'; chyba: string }

const UDALOST = 'foodtab-kiosek-doklady-klic-zmena'

function odebirat(zmena: () => void): () => void {
  window.addEventListener('storage', zmena)
  window.addEventListener(UDALOST, zmena)
  return () => {
    window.removeEventListener('storage', zmena)
    window.removeEventListener(UDALOST, zmena)
  }
}
function cistKlic(): string | null {
  try {
    return window.localStorage.getItem(KLIC_ZARIZENI_ULOZISTE)
  } catch {
    return null
  }
}
const klicNaServeru = (): string | null | undefined => undefined
const zPlochy = (): boolean => window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches
const zPlochyNaServeru = (): boolean => true
const nicNeodebira = (): (() => void) => () => {}
const noveId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))

export default function KiosekDoklady() {
  const klic = useSyncExternalStore(odebirat, cistKlic, klicNaServeru)
  const jeZPlochy = useSyncExternalStore(nicNeodebira, zPlochy, zPlochyNaServeru)
  const [spojeni, setSpojeni] = useState<Spojeni>({ druh: 'nacitam' })
  const [pokus, setPokus] = useState(0)
  const [chybaParovani, setChybaParovani] = useState('')
  const [fotky, setFotky] = useState<Fotka[]>([])
  const [oznaceni, setOznaceni] = useState('')
  const [chyba, setChyba] = useState('')
  const [odesilam, setOdesilam] = useState(false)
  const [postup, setPostup] = useState('')
  const [klientId, setKlientId] = useState<string>(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : ''))
  const [odeslano, setOdeslano] = useState<{ pocet: number; cas: string } | null>(null)
  /** Přehled dnešních dokladů z tohoto telefonu; `null` = nenačteno (nebo zařízení nesmí). */
  const [dnes, setDnes] = useState<DokladDnes[] | null>(null)
  const [verzePrehledu, setVerzePrehledu] = useState(0)
  /** Zrušení probíhajícího odeslání (tlačítko „Zrušit odesílání“). */
  const zruseni = useRef<AbortController | null>(null)
  /** Adresy náhledů, které ještě nejsou uvolněné. */
  const nahledy = useRef<Set<string>>(new Set())

  const ohlasit = () => window.dispatchEvent(new Event(UDALOST))

  // Stav zařízení: pobočka a název — nic víc server nevrací.
  useEffect(() => {
    if (!klic) return
    let zruseno = false
    nacistStavKiosku(klic)
      .then((s) => {
        if (zruseno) return
        if (!s.ok) setDnes(null)
        if (s.ok) setSpojeni({ druh: 'ok', pobocka: s.pobocka, zarizeni: s.zarizeni })
        else if (s.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })
        else if (s.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })
        else setSpojeni({ druh: 'vypadek', chyba: s.chyba })
      })
      .catch((e: unknown) => {
        if (!zruseno) setSpojeni({ druh: 'vypadek', chyba: hlaskaKiosku(e instanceof Error ? e.message : null, 'Nepodařilo se spojit se serverem.') })
      })
    return () => {
      zruseno = true
    }
  }, [klic, pokus])

  // Přehled dnešních dokladů: po připojení a po každém odeslání. Odvolané
  // nebo vypnuté zařízení dostane od serveru chybu — přehled zmizí.
  useEffect(() => {
    if (!klic || spojeni.druh !== 'ok') return
    let zruseno = false
    nacistDnesniDoklady(klic)
      .then((p) => {
        if (zruseno) return
        setDnes(p.ok ? p.doklady : null)
        if (!p.ok && p.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })
        else if (!p.ok && p.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })
      })
      .catch(() => {
        if (!zruseno) setDnes(null)
      })
    return () => {
      zruseno = true
    }
  }, [klic, spojeni.druh, verzePrehledu])

  // Přehled se obnovuje i sám: když se obrazovka znovu ukáže a jednou za
  // minutu. Odvolání nebo vypnutí tak přehled vyprázdní bez dalšího
  // odeslání a ráno nezůstane ležet včerejší seznam.
  useEffect(() => {
    if (!klic || spojeni.druh !== 'ok') return
    const obnovit = () => {
      if (document.visibilityState === 'visible') setVerzePrehledu((v) => v + 1)
    }
    const casovac = window.setInterval(obnovit, OBNOVA_PREHLEDU_MS)
    document.addEventListener('visibilitychange', obnovit)
    return () => {
      window.clearInterval(casovac)
      document.removeEventListener('visibilitychange', obnovit)
    }
  }, [klic, spojeni.druh])

  // Náhledy: uvolnit jen adresy fotek, které ze seznamu opravdu zmizely
  // (ne všechny při každé změně — po návratu na obrazovku by byly rozbité),
  // zbytek až při odchodu z obrazovky.
  useEffect(() => {
    const drzene = nahledy.current
    const ted = fotky.flatMap((f) => (f.nahled ? [f.nahled] : []))
    for (const adresa of nahledyKUvolneni(drzene, ted)) {
      URL.revokeObjectURL(adresa)
      drzene.delete(adresa)
    }
    for (const adresa of ted) drzene.add(adresa)
  }, [fotky])
  useEffect(() => {
    const drzene = nahledy.current
    return () => drzene.forEach((adresa) => URL.revokeObjectURL(adresa))
  }, [])

  async function registrovat(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const kod = new FormData(e.currentTarget).get('kod')
    setChybaParovani('')
    try {
      // Bez časového limitu: kód je jednorázový (lib/supabase/kiosek.ts).
      // Telefon dostane účel „doklady“ — kiosek Docházky na něm nefunguje.
      const { data, error } = await getKioskSupabase({ bezLimitu: true }).rpc('registrovat_zarizeni_doklady', { p_kod: String(kod ?? '') })
      if (error) throw new Error(error.message)
      const radek = (data as { klic: string }[])[0]
      if (!radek?.klic) throw new Error('Server nevrátil klíč zařízení.')
      window.localStorage.setItem(KLIC_ZARIZENI_ULOZISTE, radek.klic)
      setSpojeni({ druh: 'nacitam' })
      ohlasit()
    } catch (duvod) {
      setChybaParovani(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Spárování se nepovedlo.'))
    }
  }

  function sparovatZnovu() {
    // Jen po výslovném „zařízení neznám" z databáze (stav odpojeno).
    window.localStorage.removeItem(KLIC_ZARIZENI_ULOZISTE)
    setSpojeni({ druh: 'nacitam' })
    ohlasit()
  }

  function pridatFotky(seznam: FileList | null) {
    if (!seznam || seznam.length === 0) return
    setChyba('')
    const nove = Array.from(seznam).map((soubor) => ({
      id: noveId(),
      soubor,
      nahled: soubor.type.startsWith('image/') ? URL.createObjectURL(soubor) : null,
      odeslana: false,
    }))
    // Prázdný seznam nebo všechno odeslané: další fotky jsou NOVÝ doklad
    // (jinak by se přilepily ke starému záznamu se starým označením).
    if (zacinaNovyDoklad(fotky)) {
      setKlientId(noveId())
      // Poznámka patřila odeslanému dokladu; do prázdného seznamu ji obsluha mohla napsat pro tenhle.
      if (fotky.length > 0) setOznaceni('')
      setFotky(nove.slice(0, 10))
      return
    }
    setFotky((f) => [...f, ...nove].slice(0, 10))
  }

  /** Databáze řekla, že doklad je uzavřený: zbylé fotky půjdou jako nový doklad. */
  function zacitNovyDokladPoUzavreni() {
    setKlientId(noveId())
    setFotky((f) => f.filter((x) => !x.odeslana))
  }

  async function odeslat() {
    if (!klic || odesilam) return
    const kOdeslani = fotky.filter((f) => !f.odeslana)
    if (kOdeslani.length === 0) return
    const tohleOdeslani = new AbortController()
    zruseni.current = tohleOdeslani
    const signal = tohleOdeslani.signal
    setOdesilam(true)
    setChyba('')
    try {
      // 1. Zmenšit fotky nad strop (a převést HEIC apod.) — stejné pravidlo jako ve Financích.
      setPostup('Připravuji fotky…')
      const vyber = zkontrolovatVyber(kOdeslani.map((f) => ({ name: f.soubor.name, type: f.soubor.type, size: f.soubor.size })), 0)
      if (vyber.chyby.length > 0) throw new Error(vyber.chyby[0])
      const pripravene: { fotka: Fotka; blob: Blob; typ: string }[] = []
      for (const p of vyber.polozky) {
        const fotka = kOdeslani[p.index]
        let blob: Blob = fotka.soubor
        if (p.akce === 'zmensit') {
          const zmenseny = await zmensitDoklad(fotka.soubor)
          if (!zmenseny) throw new Error(`Fotku „${fotka.soubor.name}“ se nepodařilo zmenšit — vyfoťte ji znovu.`)
          blob = zmenseny
        }
        const typ = blob.type || fotka.soubor.type
        const chybaPo = zkontrolovatPoZmenseni(fotka.soubor.name, typ, blob.size)
        if (chybaPo) throw new Error(chybaPo)
        pripravene.push({ fotka, blob, typ })
      }

      // 2. Založit záznam a dostat podepsané adresy (server ověří klíč zařízení).
      setPostup('Zakládám doklad…')
      const pripraveno = await sLimitem(
        pripravitDoklad({ klic, oznaceni, klientId, soubory: pripravene.map((p) => ({ typ: p.typ, velikost: p.blob.size })) }),
        LIMIT_AKCE_MS,
        signal,
      )
      if (!pripraveno.ok) {
        if (pripraveno.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })
        else if (pripraveno.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })
        else if (novyKlicPoChybe(pripraveno.stav)) zacitNovyDokladPoUzavreni()
        throw new Error(pripraveno.chyba)
      }

      // 3. Nahrát fotky na podepsané adresy (bez přihlášení, jen s tokenem; „Zrušit“ nahrávání přeruší).
      const kbelik = getKioskSupabaseNahravani(signal).storage.from(KBELIK_JINYCH_PLATEB)
      for (let i = 0; i < pripraveno.nahrani.length; i++) {
        setPostup(`Nahrávám fotku ${i + 1} z ${pripraveno.nahrani.length}…`)
        const n = pripraveno.nahrani[i]
        const { error } = await sLimitem(kbelik.uploadToSignedUrl(n.cesta, n.token, pripravene[i].blob, { contentType: n.typ }), LIMIT_NAHRANI_MS, signal)
        if (error) throw new Error(hlaskaKiosku(error.message, 'Fotku se nepodařilo nahrát.'))
      }

      // 4. Server fotky ověří a připojí.
      setPostup('Kontroluji fotky…')
      const hotovo = await sLimitem(dokoncitDoklad({ klic, zaznam: pripraveno.zaznam, cesty: pripraveno.nahrani.map((n) => n.cesta) }), LIMIT_AKCE_MS, signal)
      const odeslaneId = new Set(pripravene.slice(0, hotovo.pripojeno).map((p) => p.fotka.id))
      setFotky((f) => f.map((x) => (odeslaneId.has(x.id) ? { ...x, odeslana: true } : x)))
      if (!hotovo.ok) {
        if (hotovo.stav === 'odpojeno') setSpojeni({ druh: 'odpojeno' })
        else if (hotovo.stav === 'vypnuto') setSpojeni({ druh: 'vypnuto' })
        else if (novyKlicPoChybe(hotovo.stav)) zacitNovyDokladPoUzavreni()
        throw new Error(hotovo.chyba)
      }

      setVerzePrehledu((v) => v + 1)
      const celkem = fotky.filter((f) => f.odeslana).length + hotovo.pripojeno
      setOdeslano({ pocet: celkem, cas: datumACasVPasmu(new Date().toISOString(), 'Europe/Prague').split(' ').pop() ?? '' })
    } catch (e) {
      setChyba(e instanceof Error ? e.message : 'Doklad se nepodařilo odeslat. Zkuste to znovu.')
    } finally {
      // Po limitu nebo chybě nahrávání opravdu zastavit (jinak by dojelo na starou cestu a soupeřilo s dalším pokusem).
      tohleOdeslani.abort()
      if (zruseni.current === tohleOdeslani) zruseni.current = null
      setOdesilam(false)
      setPostup('')
    }
  }

  function dalsiDoklad() {
    setFotky([])
    setOznaceni('')
    setChyba('')
    setOdeslano(null)
    setKlientId(noveId())
  }

  const stav: StavObrazovky = useMemo(() => {
    if (klic === undefined) return { druh: 'pripojuji' }
    if (!klic) return { druh: 'parovani', chyba: chybaParovani, zPlochy: jeZPlochy }
    if (spojeni.druh === 'nacitam') return { druh: 'pripojuji' }
    if (spojeni.druh === 'odpojeno') return { druh: 'odpojeno' }
    if (spojeni.druh === 'vypnuto') return { druh: 'vypnuto', chyba: HLASKA_KIOSEK_VYPNUTY }
    if (spojeni.druh === 'vypadek') return { druh: 'vypadek', chyba: spojeni.chyba }
    if (odeslano) return { druh: 'odeslano', pobocka: spojeni.pobocka, pocet: odeslano.pocet, cas: odeslano.cas, dnes }
    const naObrazovce: FotkaNaObrazovce[] = fotky.map((f) => ({ id: f.id, nahled: f.nahled, nazev: f.soubor.name || 'fotka', pdf: f.soubor.type === 'application/pdf', odeslana: f.odeslana }))
    return { druh: 'foceni', pobocka: spojeni.pobocka, zarizeni: spojeni.zarizeni, fotky: naObrazovce, oznaceni, chyba, odesilam, postup, dnes }
  }, [klic, chybaParovani, jeZPlochy, spojeni, odeslano, fotky, oznaceni, chyba, odesilam, postup, dnes])

  return (
    <ObrazovkaKiosku
      stav={stav}
      akce={{
        registrovat,
        sparovatZnovu,
        zkusitZnovu: () => {
          setSpojeni({ druh: 'nacitam' })
          setPokus((p) => p + 1)
        },
        pridatFotky,
        odebratFotku: (id) => setFotky((f) => f.filter((x) => x.id !== id || x.odeslana)),
        zmenitOznaceni: setOznaceni,
        odeslat: () => void odeslat(),
        zrusitOdeslani: () => zruseni.current?.abort(),
        dalsiDoklad,
      }}
    />
  )
}
