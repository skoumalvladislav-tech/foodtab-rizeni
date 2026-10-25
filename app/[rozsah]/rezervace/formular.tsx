'use client'

import { startTransition, useActionState, useRef, useState } from 'react'

import { noveId } from '@/lib/obrazky'
import { KBELIK_REZERVACI, MAX_PRILOH_REZERVACE, cestaPrilohy, jeObrazek, velikostText, zkontrolovatVyber } from '@/lib/rezervace-prilohy'
import {
  DRUHY,
  NAZVY_DRUHU,
  NAZVY_STAVU,
  NAZVY_ZALOHY,
  STAVY,
  STAVY_ZALOHY,
  precistFormular,
  type DruhRezervace,
} from '@/lib/rezervace-typy'
import { getBrowserSupabase } from '@/lib/supabase/client'

import Ikona from '../ikona'
import { ulozitRezervaci, type StavFormulare } from './akce'
import { pripravitSoubor } from './priprava-souboru'

/** Vybraný dokument k nové rezervaci; `nahrano` = cesta v úložišti a pobočka, pod kterou se nahrál. */
type Dokument = { id: string; soubor: File; nahrano: { cesta: string; pobocka: string; nazev: string; mime: string; velikost: number } | null }

export type HodnotyFormulare = {
  druh: DruhRezervace
  stav: string
  jmeno_hosta: string
  nazev: string
  typ_akce: string
  datum: string
  od: string
  do: string
  pocet_osob: string
  prostor: string
  menu: string
  zaloha: string
  zaloha_hosta_stav: string
  telefon: string
  email: string
}

/**
 * Formulář rezervace nebo akce — nové i úprava.
 *
 * Klientský kvůli dvěma věcem: chyby se ukážou u formuláře (ne v adrese,
 * kam nepatří jméno ani telefon hosta) a druh přepíná, která pole dávají
 * smysl (akce má název, typ a menu).
 *
 * `jenFoodtab`: rezervace přišla z rezervačního systému. Čas, počet,
 * stav, jméno a kontakt patří tam — formulář je ukáže jen ke čtení
 * a neodešle je (databáze by je odmítla). Měnit jde jen to, co patří
 * Foodtabu.
 *
 * DVOJÍ ŤUKNUTÍ NEZDVOJÍ REZERVACI: nová nese číslo odeslání (`klic`,
 * vylosované serverem) a databáze ho podruhé nezapíše. Po chybě se číslo
 * nemění — po úspěchu se odchází na detail.
 *
 * DOKUMENTY UŽ PŘI ZALOŽENÍ (Šéfík 25. 10. 2026: „do položky na přidání
 * rezervace přidej možnost přidání souboru pdf, jpg“). Soubory jdou
 * z prohlížeče rovnou do úložiště (serverová akce má strop 1 MB) pod
 * zvolenou pobočku; akce pak rezervaci založí a soubory k ní připojí —
 * databáze u každého ověří, že v úložišti je a sedí typ i velikost.
 * Formulář se nejdřív zkontroluje tady, ať se kvůli překlepu nenahrávají
 * soubory zbytečně. Už nahrané soubory se při opakovaném odeslání
 * nenahrávají znovu (a opakované připojení databáze pozná).
 */
export default function FormularRezervace({
  rozsah,
  id,
  pobocky,
  pobocka,
  hodnoty,
  jenFoodtab,
  klic,
  tenantId = '',
}: {
  rozsah: string
  /** `null` = nová. */
  id: string | null
  /** U nové: pobočky, na které člověk zapisuje. U úpravy se pobočka nemění. */
  pobocky: { id: string; nazev: string }[]
  pobocka: string
  hodnoty: HodnotyFormulare
  jenFoodtab: boolean
  klic: string
  /** Firma do cesty v úložišti — jen u nové rezervace (dokumenty při založení). */
  tenantId?: string
}) {
  const [druh, setDruh] = useState<DruhRezervace>(hodnoty.druh)
  const [stav, akce, ceka] = useActionState<StavFormulare, FormData>(ulozitRezervaci, { stav: 'klid' })
  const [dokumenty, setDokumenty] = useState<Dokument[]>([])
  const [chybyDokumentu, setChybyDokumentu] = useState<string[]>([])
  const [nahrava, setNahrava] = useState(false)
  const vstupRef = useRef<HTMLInputElement>(null)
  const dokumentyRef = useRef<Dokument[]>([])

  const jeAkce = druh === 'akce'
  const sDokumenty = !id && tenantId !== ''

  function nastavDokumenty(nove: Dokument[]) {
    dokumentyRef.current = nove
    setDokumenty(nove)
  }

  function vybrat(seznam: FileList | null) {
    if (!seznam || seznam.length === 0) return
    const soubory = Array.from(seznam)
    const kontrola = zkontrolovatVyber(
      soubory.map((s) => ({ name: s.name, type: s.type, size: s.size })),
      dokumentyRef.current.length,
    )
    setChybyDokumentu(kontrola.chyby)
    nastavDokumenty([...dokumentyRef.current, ...kontrola.platne.map((i) => ({ id: noveId(), soubor: soubory[i], nahrano: null }))])
    if (vstupRef.current) vstupRef.current.value = ''
  }

  function odebrat(idDokumentu: string) {
    const pryc = dokumentyRef.current.find((d) => d.id === idDokumentu)
    nastavDokumenty(dokumentyRef.current.filter((d) => d.id !== idDokumentu))
    // Už nahraný soubor bez rezervace je sirotek — zkusit uklidit, neškodí, když to nevyjde.
    if (pryc?.nahrano) void getBrowserSupabase().storage.from(KBELIK_REZERVACI).remove([pryc.nahrano.cesta]).catch(() => undefined)
  }

  /** Nahraje, co ještě nahrané není (nebo je pod jinou pobočkou). Vrací chyby; prázdné = vše nahrané. */
  async function nahratDokumenty(proPobocku: string): Promise<string[]> {
    const chyby: string[] = []
    const supabase = getBrowserSupabase()
    for (const d of dokumentyRef.current) {
      if (d.nahrano && d.nahrano.pobocka === proPobocku) continue
      const pripraveny = await pripravitSoubor(d.soubor)
      if (pripraveny.stav === 'chyba') {
        chyby.push(pripraveny.duvod)
        continue
      }
      const cesta = cestaPrilohy(tenantId, proPobocku, noveId(), pripraveny.mime)
      const { error } = await supabase.storage.from(KBELIK_REZERVACI).upload(cesta, pripraveny.blob, { contentType: pripraveny.mime, upsert: false })
      if (error) {
        chyby.push(`„${pripraveny.nazev}“ se nepodařilo nahrát: ${error.message}`)
        continue
      }
      nastavDokumenty(
        dokumentyRef.current.map((x) =>
          x.id === d.id ? { ...x, nahrano: { cesta, pobocka: proPobocku, nazev: pripraveny.nazev, mime: pripraveny.mime, velikost: pripraveny.blob.size } } : x,
        ),
      )
    }
    return chyby
  }

  async function odeslat(fd: FormData) {
    if (sDokumenty && dokumentyRef.current.length > 0) {
      // Nejdřív formulář: s překlepem v datu se soubory nenahrávají.
      // Chyby pak vrátí server (tytéž věty), soubory zůstanou vybrané.
      const kontrola = precistFormular((k) => fd.get(k) as string | null, { jenFoodtab: false })
      if (kontrola.stav === 'ok') {
        setNahrava(true)
        setChybyDokumentu([])
        try {
          const chyby = await nahratDokumenty(String(fd.get('pobocka') ?? pobocka))
          if (chyby.length > 0) {
            setChybyDokumentu([...chyby, 'Rezervace se zatím nezapsala — opravte dokumenty (nebo je odeberte) a zkuste to znovu.'])
            return
          }
        } catch {
          setChybyDokumentu(['Není spojení — dokumenty se nenahrály, rezervace se nezapsala. Zkuste to znovu.'])
          return
        } finally {
          setNahrava(false)
        }
        fd.set(
          'prilohy',
          JSON.stringify(dokumentyRef.current.flatMap((d) => (d.nahrano ? [{ cesta: d.nahrano.cesta, nazev: d.nahrano.nazev, mime: d.nahrano.mime, velikost: d.nahrano.velikost }] : []))),
        )
      }
    }
    startTransition(() => akce(fd))
  }

  const zaneprazdneno = ceka || nahrava

  return (
    <form action={odeslat} className="ds-rez-formular" aria-describedby={stav.stav === 'chyba' ? 'rez-chyby' : undefined}>
      <input type="hidden" name="rozsah" value={rozsah} />
      {id ? <input type="hidden" name="id" value={id} /> : <input type="hidden" name="klic" value={klic} />}

      {stav.stav === 'chyba' ? (
        <div id="rez-chyby" role="alert">
          {stav.chyby.map((c) => (
            <p key={c} className="hlaska-chyba" style={{ margin: '0 0 6px' }}>
              {c}
            </p>
          ))}
        </div>
      ) : null}

      <div className="ds-rez-mrizka">
        <label className="ds-field">
          <span className="ds-field-label">Druh</span>
          <select className="ds-input" name="druh" value={druh} onChange={(e) => setDruh(e.target.value as DruhRezervace)}>
            {DRUHY.map((d) => (
              <option key={d} value={d}>
                {d === 'akce' ? 'Akce (uzavřená společnost, catering…)' : NAZVY_DRUHU[d]}
              </option>
            ))}
          </select>
        </label>
        {!id && pobocky.length > 1 ? (
          <label className="ds-field">
            <span className="ds-field-label">Pobočka</span>
            <select className="ds-input" name="pobocka" defaultValue={pobocka} required>
              {pobocky.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nazev}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="pobocka" value={pobocka} />
        )}
        {jeAkce ? (
          <>
            <label className="ds-field">
              <span className="ds-field-label">Název akce</span>
              <input className="ds-input" name="nazev" defaultValue={hodnoty.nazev} maxLength={120} placeholder="Firemní večírek ACME" />
            </label>
            <label className="ds-field">
              <span className="ds-field-label">Typ akce</span>
              <input
                className="ds-input"
                name="typ_akce"
                defaultValue={hodnoty.typ_akce}
                maxLength={80}
                placeholder="Svatba, narozeniny, catering…"
              />
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="nazev" value={hodnoty.nazev} />
            <input type="hidden" name="typ_akce" value={hodnoty.typ_akce} />
          </>
        )}
      </div>

      {jenFoodtab ? (
        <p className="ds-rez-zdroj">
          Čas, počet osob, stav, jméno a kontakt přišly z rezervačního systému a mění se tam — při dalším načtení by se
          změna ve Foodtabu přepsala. Tady jde upravit druh, název, typ akce, prostor, menu a zálohu.
        </p>
      ) : (
        <div className="ds-rez-mrizka">
          <label className="ds-field">
            <span className="ds-field-label">{jeAkce ? 'Objednatel' : 'Na jméno'}</span>
            <input className="ds-input" name="jmeno_hosta" defaultValue={hodnoty.jmeno_hosta} maxLength={120} required={!jeAkce} autoComplete="off" />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Datum</span>
            <input className="ds-input" type="date" name="datum" defaultValue={hodnoty.datum} required />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Od</span>
            <input className="ds-input" type="time" name="od" defaultValue={hodnoty.od} required />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Do (nepovinné)</span>
            <input className="ds-input" type="time" name="do" defaultValue={hodnoty.do} />
            <span className="ds-field-hint">Dřív než začátek = přes půlnoc.</span>
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Počet osob</span>
            <input className="ds-input" type="number" inputMode="numeric" min={1} max={10000} name="pocet_osob" defaultValue={hodnoty.pocet_osob} required={!jeAkce} />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Stav</span>
            <select className="ds-input" name="stav" defaultValue={hodnoty.stav}>
              {STAVY.map((s) => (
                <option key={s} value={s}>
                  {NAZVY_STAVU[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Telefon</span>
            <input className="ds-input" type="tel" name="telefon" defaultValue={hodnoty.telefon} maxLength={40} autoComplete="off" />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">E-mail</span>
            <input className="ds-input" type="email" name="email" defaultValue={hodnoty.email} maxLength={254} autoComplete="off" />
          </label>
        </div>
      )}

      <div className="ds-rez-mrizka">
        <label className="ds-field">
          <span className="ds-field-label">Stůl nebo prostor</span>
          <input className="ds-input" name="prostor" defaultValue={hodnoty.prostor} maxLength={120} placeholder="Stůl 12, salonek, terasa…" />
        </label>
        <label className="ds-field">
          <span className="ds-field-label">Záloha od hosta (Kč)</span>
          <input className="ds-input" name="zaloha" inputMode="decimal" defaultValue={hodnoty.zaloha} placeholder="např. 5000" />
        </label>
        <label className="ds-field">
          <span className="ds-field-label">Stav zálohy</span>
          <select className="ds-input" name="zaloha_hosta_stav" defaultValue={hodnoty.zaloha_hosta_stav}>
            {STAVY_ZALOHY.map((s) => (
              <option key={s} value={s}>
                {NAZVY_ZALOHY[s]}
              </option>
            ))}
          </select>
          <span className="ds-field-hint">Jen evidence — peníze se tady neposílají.</span>
        </label>
      </div>

      <label className="ds-field">
        <span className="ds-field-label">{jeAkce ? 'Menu a program' : 'Menu (nepovinné)'}</span>
        <textarea className="ds-input ds-rez-text" name="menu" defaultValue={hodnoty.menu} maxLength={4000} />
      </label>

      {sDokumenty ? (
        <div className="ds-field">
          <span className="ds-field-label">Dokumenty (nepovinné)</span>
          {/* Bez `name`: soubor nejde přes serverovou akci (strop 1 MB), ale rovnou do úložiště. */}
          <input ref={vstupRef} type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => vybrat(e.target.files)} />
          {dokumenty.length > 0 ? (
            <ul className="ds-rez-prilohy">
              {dokumenty.map((d) => (
                <li key={d.id} className="ds-rez-priloha">
                  <Ikona klic={jeObrazek(d.soubor.type) ? 'fotka' : 'faktura'} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={d.soubor.name}>
                    {d.soubor.name}
                  </span>
                  <small>{velikostText(d.soubor.size)}</small>
                  <button
                    type="button"
                    className="ft-tl ft-tl-vedlejsi ft-tl-male"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => odebrat(d.id)}
                    disabled={zaneprazdneno}
                    aria-label={`Odebrat ${d.soubor.name}`}
                  >
                    Odebrat
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="ds-rez-tlacitka" style={{ alignItems: 'center' }}>
            <button
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => vstupRef.current?.click()}
              disabled={zaneprazdneno || dokumenty.length >= MAX_PRILOH_REZERVACE}
            >
              <Ikona klic="sponka" /> Přidat dokument
            </button>
            <span className="ds-field-hint">Fotka nebo PDF — smlouva, menu, plán sálu… Každý soubor do 10 MB, nejvýš {MAX_PRILOH_REZERVACE}.</span>
          </div>
          <div aria-live="polite">
            {chybyDokumentu.map((c, i) => (
              <p key={i} className="hlaska-chyba" role="alert" style={{ margin: '4px 0 0' }}>
                {c}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {id ? null : (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
          Poznámky (alergie, dort, kontakt na DJ…) se přidávají v detailu po uložení.
        </p>
      )}

      <div className="ds-rez-tlacitka">
        <button type="submit" className="ft-tl ft-tl-hlavni" disabled={zaneprazdneno}>
          {nahrava ? 'Nahrávají se dokumenty…' : ceka ? 'Ukládá se…' : id ? 'Uložit změny' : jeAkce ? 'Zapsat akci' : 'Zapsat rezervaci'}
        </button>
      </div>
    </form>
  )
}
