import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import type { NavrhUkolu } from '@/lib/komunikace/navrh-ukolu'
import TlacitkoOdeslat from '../../tlacitko-odeslat'

/**
 * Formulář úkolu ze zprávy — jen vykreslení.
 *
 * Data (zpráva, návrh, seznamy adresátů) mu dodá stránka; formulář nesahá do
 * databáze, takže se dá vykreslit i v dočasném náhledu na snímky obrazovky.
 * Odeslání obsluhuje akce předaná zvenku.
 *
 * NÁVRH JE JEN PŘEDVYPLNĚNÍ. Co je nejasné (termín), je označené k ověření a
 * úkol vznikne až odesláním.
 */
export default function FormularUkolu({
  akce,
  rozsah,
  konverzace,
  zpravaId,
  citat,
  vytvoreno,
  jeHlasovka,
  navrh,
  duvodBezModelu,
  poznamkaKPrepisu,
  chyba,
  lide,
  useky,
  pozice,
  zpet,
}: {
  akce: (formData: FormData) => void | Promise<void>
  rozsah: string
  konverzace: string
  zpravaId: string
  citat: string
  /** ISO okamžik zprávy. */
  vytvoreno: string
  jeHlasovka: boolean
  navrh: NavrhUkolu | null
  /** Věta o tom, proč návrh nedělá jazykový model (nedostupný); null = nezobrazovat. */
  duvodBezModelu: string | null
  /** Věta o přepisu hlasu (jen u hlasovek). */
  poznamkaKPrepisu: string
  chyba?: string | null
  lide: { employee_id: string; jmeno: string }[]
  useky: [string, string][]
  pozice: [string, string][]
  zpet: string
}) {
  const kontrolaTerminu = navrh?.vyzadujeKontrolu.includes('termin') ?? false
  const naTerminu = navrh?.termin ?? null

  return (
    <section className="ds-plocha" style={{ maxWidth: '720px' }}>
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: '0 0 14px' }}>
          {chyba}
        </p>
      ) : null}

      <blockquote
        style={{
          margin: '0 0 16px', padding: '10px 14px', borderLeft: '3px solid var(--line-2)',
          background: 'var(--sunken)', borderRadius: '0 10px 10px 0', fontSize: '14px', lineHeight: 1.5,
        }}
      >
        <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '2px' }}>
          Zpráva z {datumACasVPasmu(vytvoreno, ZONA_VYCHOZI)}
        </span>
        {citat !== '' ? citat : jeHlasovka ? 'Hlasová zpráva.' : ''}
      </blockquote>

      <form action={akce} className="pc-formular">
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="konverzace" value={konverzace} />
        <input type="hidden" name="zprava" value={zpravaId} />

        <div className="pc-poznamka-navrhu">
          {navrh ? (
            <>
              <strong>Návrh sestavil pravidlový nástroj v aplikaci.</strong> Text zprávy nikam
              neodešel. Cokoli tu můžete změnit.
              {navrh.nalezy.length > 0 ? (
                <ul>
                  {navrh.nalezy.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : (
                <> Ve zprávě se nepoznal žádný termín ani naléhavost.</>
              )}
            </>
          ) : (
            <>
              <strong>Návrh se nesestavil.</strong>{' '}
              {jeHlasovka
                ? `Hlasová zpráva nemá text. ${poznamkaKPrepisu} Vyplňte úkol ručně.`
                : 'Zpráva nemá text, ze kterého by se dal návrh udělat. Vyplňte úkol ručně.'}
            </>
          )}
          {duvodBezModelu ? (
            <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
              Návrh jazykovým modelem zapnutý není. {duvodBezModelu}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="uk-nazev">Název úkolu</label>
          <input id="uk-nazev" type="text" name="nazev" required maxLength={120} defaultValue={navrh?.nazev ?? ''} />
        </div>

        <div>
          <label htmlFor="uk-poznamka">Poznámka (nepovinná)</label>
          <textarea id="uk-poznamka" name="poznamka" maxLength={1000} defaultValue={navrh?.poznamka ?? ''} />
        </div>

        <div className="pc-upozorneni-soukromi">
          Název a poznámku uvidí všichni, kdo úkoly vidí — <strong>ne jen účastníci rozhovoru</strong>.
          Zkontrolujte, že v nich není nic, co patří jen do rozhovoru.
        </div>

        <div>
          <div className="pc-dvojice">
            <div>
              <label htmlFor="uk-den">Termín — den</label>
              <input
                id="uk-den"
                type="date"
                name="termin_datum"
                defaultValue={naTerminu?.datum ?? ''}
                data-kontrola={kontrolaTerminu ? '1' : undefined}
              />
            </div>
            <div>
              <label htmlFor="uk-cas">Čas (nepovinný)</label>
              <input
                id="uk-cas"
                type="time"
                name="termin_cas"
                defaultValue={naTerminu?.cas ?? ''}
                data-kontrola={kontrolaTerminu ? '1' : undefined}
              />
            </div>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: kontrolaTerminu ? 'var(--pozor)' : 'var(--muted)' }}>
            {kontrolaTerminu
              ? 'Termín je k ověření — ze zprávy nebyl jednoznačný.'
              : 'Bez času platí úkol do konce zvoleného dne.'}
          </p>
        </div>

        <fieldset>
          <legend>Komu</legend>
          <label className="pc-volba">
            <input type="radio" name="komu" value="pobocka" defaultChecked /> Nikomu konkrétnímu (celá pobočka)
          </label>
          <label className="pc-volba">
            <input type="radio" name="komu" value="clovek" /> Člověku
          </label>
          <select name="clovek" aria-label="Člověk" defaultValue="">
            <option value="">— vyberte —</option>
            {lide.map((c) => (
              <option key={c.employee_id} value={c.employee_id}>
                {c.jmeno}
              </option>
            ))}
          </select>
          <label className="pc-volba" style={{ marginTop: '8px' }}>
            <input type="radio" name="komu" value="usek" /> Úseku
          </label>
          <select name="usek" aria-label="Úsek" defaultValue="">
            <option value="">— vyberte —</option>
            {useky.map(([id, nazev]) => (
              <option key={id} value={id}>
                {nazev}
              </option>
            ))}
          </select>
          <label className="pc-volba" style={{ marginTop: '8px' }}>
            <input type="radio" name="komu" value="pozice" /> Zařazení
          </label>
          <select name="pozice" aria-label="Zařazení" defaultValue="">
            <option value="">— vyberte —</option>
            {pozice.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset>
          <legend>Důležitost</legend>
          <label className="pc-volba">
            <input type="radio" name="priorita" value="normal" defaultChecked={navrh?.priorita !== 'high'} /> Běžná
          </label>
          <label className="pc-volba">
            <input type="radio" name="priorita" value="high" defaultChecked={navrh?.priorita === 'high'} /> Důležitá
          </label>
        </fieldset>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Vytvářím…">
            Vytvořit úkol
          </TlacitkoOdeslat>
          <Link href={zpet} className="ft-tl ft-tl-vedlejsi">
            Zrušit
          </Link>
        </div>
      </form>
    </section>
  )
}
