'use client'

import { useActionState, useState } from 'react'

import {
  DRUHY,
  NAZVY_DRUHU,
  NAZVY_STAVU,
  NAZVY_ZALOHY,
  STAVY,
  STAVY_ZALOHY,
  type DruhRezervace,
} from '@/lib/rezervace-typy'

import { ulozitRezervaci, type StavFormulare } from './akce'

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
 */
export default function FormularRezervace({
  rozsah,
  id,
  pobocky,
  pobocka,
  hodnoty,
  jenFoodtab,
  klic,
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
}) {
  const [druh, setDruh] = useState<DruhRezervace>(hodnoty.druh)
  const [stav, akce, ceka] = useActionState<StavFormulare, FormData>(ulozitRezervaci, { stav: 'klid' })

  const jeAkce = druh === 'akce'

  return (
    <form action={akce} className="ds-rez-formular" aria-describedby={stav.stav === 'chyba' ? 'rez-chyby' : undefined}>
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

      <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
        Poznámky (alergie, dort, kontakt na DJ…) a dokumenty se přidávají v detailu po uložení.
      </p>

      <div className="ds-rez-tlacitka">
        <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
          {ceka ? 'Ukládá se…' : id ? 'Uložit změny' : jeAkce ? 'Zapsat akci' : 'Zapsat rezervaci'}
        </button>
      </div>
    </form>
  )
}
