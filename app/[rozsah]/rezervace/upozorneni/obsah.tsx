import Link from 'next/link'

import { DRUHY_UPOZORNENI_REZERVACI, souhrnVyberu, type ClovekUpozorneni } from '@/lib/rezervace-upozorneni'

import { PanelHlava } from '../../dnes/prvky'
import Nadpis from '../../nadpis'
import { ulozitUpozorneni } from '../akce'
import type { PobockaRezervaci } from '../pristup'
import { HlaskaAkce, ZalozkyRezervaci } from '../prvky'

export type { ClovekUpozorneni }

/**
 * Obsah obrazovky Upozornění — ČISTĚ KRESLICÍ. Přístup a lidi dodala
 * stránka (page.tsx). Každá pobočka má vlastní formulář: uloží se celý
 * výběr té pobočky naráz (kdo není zaškrtnutý, tomu nic nechodí).
 *
 * Obyčejný formulář bez JavaScriptu — zaškrtávátka se jménem
 * `akce` / `rezervace` / `souhrn` a hodnotou id zaměstnance.
 */
export function UpozorneniObsah({
  rozsah,
  pobocky,
  nenasazeno,
  stav,
  chyba,
}: {
  rozsah: string
  pobocky: { pobocka: PobockaRezervaci; lide: ClovekUpozorneni[] }[]
  /** Funkce z migrace 20261106100000 v databázi ještě nejsou. */
  nenasazeno: boolean
  stav?: string
  chyba?: string
}) {
  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis="Komu u které pobočky chodí upozornění k akcím, k rezervacím a ranní souhrn.">
        Upozornění
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="upozorneni" />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <ul className="ds-rez-upoz-pravidla">
          <li>
            <strong>Akce</strong> — nová akce, každá změna (den, čas, počet osob, prostor, menu, název, potvrzení, „z akce je
            rezervace“) a zrušení. Po proběhlé akci už nic.
          </li>
          <li>
            <strong>Rezervace</strong> — nová (i obnovená zrušená) a zrušená rezervace a „z rezervace je akce“. Nové
            z rezervačního systému se sčítají do jednoho upozornění („3 nové rezervace“), dokud ho člověk nepřečte.
          </li>
          <li>
            <strong>Ranní souhrn</strong> — přehled dne. Když u pobočky nikoho nezaškrtnete, chodí jako dosud všem v seznamu;
            jakmile zaškrtnete aspoň jednoho, chodí jen zaškrtnutým.
          </li>
          <li>Kdo změnu udělá (zapíše, upraví nebo zruší), tomu se o té své změně nic nepošle — o změnách od ostatních ano.</li>
          <li>
            Chybí tu někdo? V seznamu je jen ten, kdo má účet ve Foodtabu a u svého zařazení právo „Vidět rezervace a kalendář
            akcí“ (<Link href={`/${rozsah}/nastaveni/role`}>Nastavení → Zařazení</Link>). Upozornění chodí do aplikace a na
            telefon, jinam ne.
          </li>
        </ul>

        {nenasazeno ? (
          <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
            Nastavení upozornění čeká na nasazení databáze (migrace 20261106100000). Do té doby jde jen ranní souhrn všem, kdo
            rezervace vidí.
          </p>
        ) : (
          pobocky.map(({ pobocka, lide }) => (
            <section key={pobocka.id} className="ds-plocha" id={`pobocka-${pobocka.id}`}>
              <PanelHlava ikona="zvonek" nadpis={pobocka.nazev} />
              {lide.length === 0 ? (
                <p style={{ margin: 0, fontSize: '14px' }}>Rezervace téhle pobočky zatím nikdo nevidí.</p>
              ) : (
                <form action={ulozitUpozorneni} className="ds-rez-upoz">
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="pobocka" value={pobocka.id} />
                  <p className="ds-rez-upoz-stav">{souhrnVyberu(lide)}</p>
                  <div className="ds-rez-upoz-obal">
                    <table className="ds-rez-upoz-tabulka">
                      <thead>
                        <tr>
                          <th scope="col">Kdo</th>
                          {DRUHY_UPOZORNENI_REZERVACI.map((d) => (
                            <th key={d.klic} scope="col" title={d.popis}>
                              {d.nazev}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lide.map((c) => (
                          <tr key={c.employee_id}>
                            <th scope="row">
                              {c.jmeno}
                              {c.zarazeni ? <small>{c.zarazeni}</small> : null}
                            </th>
                            {DRUHY_UPOZORNENI_REZERVACI.map((d) => (
                              <td key={d.klic}>
                                <label>
                                  <input
                                    type="checkbox"
                                    name={d.klic}
                                    value={c.employee_id}
                                    defaultChecked={c[d.klic]}
                                    aria-label={`${d.nazev} — ${c.jmeno}`}
                                  />
                                </label>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <button type="submit" className="ft-tl ft-tl-hlavni">
                      Uložit výběr
                    </button>
                  </div>
                </form>
              )}
            </section>
          ))
        )}
      </div>
    </>
  )
}
