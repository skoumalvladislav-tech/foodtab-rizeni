import Link from 'next/link'

import TlacitkoOdeslat from '../../../vzkazy/tlacitko-odeslat'

/**
 * Formulář „Nahlásit problém“ — jen vykreslení.
 *
 * Stejný tvar jako formulář úkolu ze zprávy (vzkazy/[konverzace]/ukol/
 * formular-ukolu.tsx), ale bez návrhu: checklist nemá text zprávy, ze
 * kterého by šlo něco poznat, takže se nevyplňuje nic předem kromě názvu
 * u konkrétní položky. Nesahá do databáze — jde vykreslit i v náhledu.
 */
export default function FormularProblem({
  akce,
  rozsah,
  beh,
  checklistNazev,
  polozka,
  chyba,
  lide,
  useky,
  pozice,
  zpet,
}: {
  akce: (formData: FormData) => void | Promise<void>
  rozsah: string
  beh: string
  checklistNazev: string
  /** Položka, ke které se problém váže; null = týká se celého checklistu. */
  polozka: { id: string; label: string } | null
  chyba?: string | null
  lide: { employee_id: string; jmeno: string }[]
  useky: [string, string][]
  pozice: [string, string][]
  zpet: string
}) {
  return (
    <section className="ds-plocha" style={{ maxWidth: '720px' }}>
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: '0 0 14px' }}>
          {chyba}
        </p>
      ) : null}

      <p
        style={{
          margin: '0 0 16px', padding: '10px 14px', borderLeft: '3px solid var(--line-2)',
          background: 'var(--sunken)', borderRadius: '0 10px 10px 0', fontSize: '14px', lineHeight: 1.5,
        }}
      >
        <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '2px' }}>
          Checklist
        </span>
        {checklistNazev}
        {polozka ? <> — položka „{polozka.label}“</> : null}
      </p>

      <form action={akce} className="pc-formular">
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="beh" value={beh} />
        {polozka ? <input type="hidden" name="polozka" value={polozka.id} /> : null}

        <div>
          <label htmlFor="pr-nazev">Název úkolu</label>
          <input
            id="pr-nazev"
            type="text"
            name="nazev"
            required
            maxLength={120}
            defaultValue={polozka ? `Problém: ${polozka.label}` : ''}
          />
        </div>

        <div>
          <label htmlFor="pr-poznamka">Co se děje (nepovinné)</label>
          <textarea id="pr-poznamka" name="poznamka" maxLength={1000} />
        </div>

        <div>
          <div className="pc-dvojice">
            <div>
              <label htmlFor="pr-den">Termín — den</label>
              <input id="pr-den" type="date" name="termin_datum" />
            </div>
            <div>
              <label htmlFor="pr-cas">Čas (nepovinný)</label>
              <input id="pr-cas" type="time" name="termin_cas" />
            </div>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
            Bez času platí úkol do konce zvoleného dne.
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
            <input type="radio" name="priorita" value="normal" defaultChecked /> Běžná
          </label>
          <label className="pc-volba">
            <input type="radio" name="priorita" value="high" /> Důležitá
          </label>
        </fieldset>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Zakládám…">
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
