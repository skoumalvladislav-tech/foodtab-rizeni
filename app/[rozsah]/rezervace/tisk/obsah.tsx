import Link from 'next/link'

import type { Tisk, VolbyTisku } from '@/lib/rezervace-tisk'

import Ikona from '../../ikona'
import { TlacitkoTisku } from './tlacitko'

/**
 * Tiskový přehled akcí a rezervací — ČISTĚ KRESLICÍ, stejně jako
 * rezervace/obsah.tsx: data, právo a volby rozhodla stránka (page.tsx).
 *
 * Na obrazovce je to náhled listu s ovládáním nahoře (zpět, co tisknout,
 * Vytisknout). Na papíře (app/_tisk.css, `@media print`) zůstane jen
 * list: bez navigace aplikace, bez tlačítek, černé písmo na bílé, stav
 * slovem a přeškrtnutím, žádná barva, která se na černobílé tiskárně ztratí.
 *
 * `.ds-tisk` musí být PŘÍMÝ potomek `<main>` — tisková pravidla podle něj
 * schovají všechno ostatní na stránce.
 */
export function TiskObsah({
  tisk,
  volby,
  zpet,
  nazvyPobocek,
  vytisteno,
  hned = false,
}: {
  tisk: Tisk
  volby: VolbyTisku
  zpet: { href: string; text: string }
  nazvyPobocek: string[]
  /** „25. 11. 2026 14:05“ — kdy se přehled sestavil, ať je na papíře poznat, jak je starý. */
  vytisteno: string
  /** Otevřít okno tisku hned po načtení (tlačítko z kalendáře nebo Rozpisu). */
  hned?: boolean
}) {
  const vicPobocek = tisk.oddily.length > 1
  const NadpisDne = vicPobocek ? 'h3' : 'h2'

  return (
    <div className="ds-tisk">
      <div className="ds-tisk-ovladani">
        <div className="ds-tisk-radek">
          <Link href={zpet.href} className="ft-tl ft-tl-male ft-tl-vedlejsi">
            <Ikona klic="zpet" velikost={15} /> {zpet.text}
          </Link>
          <TlacitkoTisku hned={hned} />
        </div>
        {/* Volby jdou adresou (GET) — stránka je načte a omezí znovu, nic se neukládá. */}
        <form method="get" className="ds-tisk-volby" aria-label="Co tisknout">
          <input type="hidden" name="od" value={volby.od} />
          <input type="hidden" name="do" value={volby.do} />
          {volby.pobocky.length > 0 ? <input type="hidden" name="pobocky" value={volby.pobocky.join(',')} /> : null}
          {/* Jen už ověřený odkaz zpátky (`zpatkyZTisku`), ne to, co přišlo v adrese. */}
          <input type="hidden" name="zpet" value={zpet.href} />
          <fieldset className="ds-tisk-volba">
            <legend>Co tisknout</legend>
            <label>
              <input type="radio" name="co" value="vse" defaultChecked={!volby.jenAkce} /> Akce i rezervace
            </label>
            <label>
              <input type="radio" name="co" value="akce" defaultChecked={volby.jenAkce} /> Jen akce
            </label>
          </fieldset>
          <label className="ds-tisk-volba">
            <input type="checkbox" name="zrusene" value="1" defaultChecked={volby.sZrusenymi} /> I zrušené a nedorazivší
          </label>
          <button type="submit" className="ft-tl ft-tl-male ft-tl-vedlejsi">
            Použít
          </button>
        </form>
        <p className="ds-tisk-napoveda">Na papír A4 na výšku. Navigace, tlačítka a barvy se netisknou.</p>
      </div>

      <article className="ds-tisk-list" aria-label={`${tisk.nadpis} — ${tisk.obdobi}`}>
        <header className="ds-tisk-hlava">
          <h1>{tisk.nadpis}</h1>
          <p className="ds-tisk-obdobi">{tisk.obdobi}</p>
          <p className="ds-tisk-meta">
            {nazvyPobocek.join(', ')} · {tisk.rozsahTisku} · stav k {vytisteno}
          </p>
        </header>

        {tisk.oddily.map((o) => (
          <section key={o.pobocka.id} className="ds-tisk-oddil" aria-label={o.pobocka.nazev}>
            {vicPobocek ? (
              <h2 className="ds-tisk-pobocka">
                {o.pobocka.nazev} <span className="ds-tisk-souhrn">{o.souhrn}</span>
              </h2>
            ) : null}
            {o.dny.length === 0 ? <p className="ds-tisk-prazdno">V tomhle období není nic zapsáno.</p> : null}
            {o.dny.map((d) => (
              <section key={d.den} className="ds-tisk-den">
                <NadpisDne className="ds-tisk-den-nadpis">
                  {d.nadpis} <span className="ds-tisk-souhrn">{d.souhrn}</span>
                </NadpisDne>
                {d.poznamky.length > 0 ? (
                  <ul className="ds-tisk-den-poznamky" aria-label="Poznámky ke dni">
                    {d.poznamky.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : null}
                {d.polozky.length > 0 ? (
                  <table className="ds-tisk-tabulka">
                    <colgroup>
                      <col className="ds-tisk-s-cas" />
                      <col className="ds-tisk-s-nazev" />
                      <col className="ds-tisk-s-hoste" />
                      <col className="ds-tisk-s-misto" />
                      <col className="ds-tisk-s-kontakt" />
                      <col />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Čas</th>
                        <th scope="col">Akce / rezervace</th>
                        <th scope="col" className="ds-tisk-cislo">
                          Hosté
                        </th>
                        <th scope="col">Stůl / prostor</th>
                        <th scope="col">Kontakt</th>
                        <th scope="col">Poznámka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.polozky.map((p) => (
                        <tr key={p.id} data-zrusena={p.zrusena ? '' : undefined}>
                          <td className="ds-tisk-cas">{p.cas}</td>
                          <td>
                            <span className="ds-tisk-nazev">{p.nazev}</span>
                            {p.popis ? <span className="ds-tisk-popis">{p.popis}</span> : null}
                          </td>
                          <td className="ds-tisk-cislo">{p.hoste}</td>
                          <td>{p.misto || '—'}</td>
                          <td>
                            {p.kontakt || '—'}
                            {p.telefon ? <span className="ds-tisk-telefon">{p.telefon}</span> : null}
                          </td>
                          <td className="ds-tisk-poznamky">
                            {p.poznamky.length > 0 ? p.poznamky.map((t, i) => <p key={i}>{t}</p>) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
            ))}
          </section>
        ))}

        <footer className="ds-tisk-pata">
          Foodtab · {tisk.nadpis} · {tisk.obdobi} · stav k {vytisteno}
        </footer>
      </article>
    </div>
  )
}
