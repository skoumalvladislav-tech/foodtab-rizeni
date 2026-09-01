import { zapsatRucne } from './rucni'

/**
 * Ruční zápis docházky — formulář.
 *
 * Zadání docs/dochazka-qr-zadani.md, oddíl 4: ruční záznam musí
 * existovat, ale nesmí vypadat stejně jako píchnutí. Proto je i tady
 * oddělený od píchačky, má vlastní nadpis a je u něj napsáno, co to
 * znamená.
 *
 * Důvod je povinný. Není to formalita: „zapomněla telefon“ je málo
 * slov, ale nutí to člověka si uvědomit, že zapisuje něco, co se
 * takhle nestalo. Databáze kratší než tři znaky nepustí.
 *
 * Zaměstnanec tenhle formulář nevidí — kreslí se jen s attendance.manage.
 * A i kdyby ho někdo vyvolal jinudy, politika ho odmítne.
 */

export default function PanelRucni({
  rozsah,
  pobockaId,
  pobockaNazev,
  lide,
  chyba,
  zapsano,
}: {
  rozsah: string
  pobockaId: string
  pobockaNazev: string
  lide: { id: string; jmeno: string; domovska: boolean }[]
  chyba?: string
  zapsano?: boolean
}) {
  return (
    <section style={panel}>
      <h2 style={nadpis}>Zapsat docházku ručně</h2>
      <p style={popis}>
        Pro toho, kdo zapomněl telefon. Záznam se uloží označený jako
        ruční, s vaším jménem a s důvodem — v přehledu i v auditu bude
        poznat, že nevznikl píchnutím. Pobočka: <strong>{pobockaNazev}</strong>.
        V nabídce jsou i lidé, kteří sem jen zaskakují — mají tu směnu,
        i když patří jinam.
      </p>

      {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
      {zapsano ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--dobre)' }}>
          Zapsáno jako ruční záznam.
        </p>
      ) : null}

      <form action={zapsatRucne} style={mrizka}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="pobocka" value={pobockaId} />

        <label style={poleLabel}>
          <span>Kdo</span>
          <select name="zamestnanec" required style={pole}>
            <option value="">— vyberte —</option>
            {lide.map((c) => (
              <option key={c.id} value={c.id}>
                {c.jmeno}
                {c.domovska ? '' : ' — zaskakuje'}
              </option>
            ))}
          </select>
        </label>

        <label style={poleLabel}>
          <span>Co</span>
          <select name="druh" required defaultValue="in" style={pole}>
            <option value="in">Příchod</option>
            <option value="out">Odchod</option>
            <option value="break_start">Začátek přestávky</option>
            <option value="break_end">Konec přestávky</option>
          </select>
        </label>

        <label style={poleLabel}>
          <span>Kdy</span>
          <input name="kdy" type="datetime-local" required style={pole} />
        </label>

        <label style={{ ...poleLabel, gridColumn: '1 / -1' }}>
          <span>Proč ručně *</span>
          <input
            name="duvod"
            required
            minLength={3}
            maxLength={200}
            placeholder="Zapomněla telefon"
            style={{ ...pole, maxWidth: 'none' }}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni">
            Zapsat ručně
          </button>
        </div>
      </form>
    </section>
  )
}

function popisChyby(kod: string): string {
  switch (kod) {
    case 'duvod':
      return 'Napište prosím, proč se záznam zadává ručně. Aspoň tři znaky.'
    case 'neuplne':
      return 'Vyplňte kdo, co i kdy.'
    default:
      return 'Záznam se nepodařilo uložit.'
  }
}

const panel = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '66ch',
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '12px',
  alignItems: 'end',
} as const

const poleLabel = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const
