/**
 * Nedokončená docházka — příchod bez odchodu.
 *
 * Nález z kontroly 1. 9. 2026: obrazovka tvrdila „Jste v práci · od
 * 21:42“ a pod tím 0 h 0 min, 0 Kč. Otevřený příchod se do mzdy
 * nezapočítá, což je správně — z vymyšleného času odchodu by se
 * počítala mzda — ale nikde to nebylo vidět. Tichá nula je horší než
 * chyba: součet vypadá věrohodně.
 *
 * Aplikace záznam NIKDY nezavírá sama (rozhodl Šéfík 1. 9.). Tenhle
 * panel proto nic neopravuje, jen to říká nahlas — a rozlišuje, jestli
 * si to člověk může spravit sám. Nemůže: opravit docházku smí jen
 * attendance.manage, takže zaměstnanec dostane pokyn říct si o to.
 */

export type NedokoncenaProp = {
  employee_id: string
  jmeno: string
  business_date: string
  zacatek: string
  moje: boolean
}

export default function PanelNedokoncene({
  zaznamy,
  smiOpravit,
}: {
  zaznamy: NedokoncenaProp[]
  smiOpravit: boolean
}) {
  if (zaznamy.length === 0) return null

  const moje = zaznamy.filter((z) => z.moje)
  const cizi = zaznamy.filter((z) => !z.moje)

  return (
    <section style={panel}>
      <h2 style={nadpis}>
        {zaznamy.length === 1
          ? 'Jeden záznam docházky není dokončený'
          : `${zaznamy.length} záznamů docházky není dokončených`}
      </h2>

      <p style={popis}>
        Příchod bez odchodu. <strong>Do odpracovaných hodin ani do mzdy se
        nezapočítává</strong> — dokud se neví, kdy směna skončila, nedá se
        z ní nic spočítat. Aplikace si čas odchodu nedomýšlí.
      </p>

      <ul style={seznam}>
        {[...moje, ...cizi].map((z) => (
          <li key={`${z.employee_id}-${z.business_date}`} style={radek}>
            <span>
              <strong>{z.moje ? 'Vy' : z.jmeno}</strong>{' '}
              <span style={{ color: 'var(--muted)' }}>
                — příchod {den(z.business_date)} v {cas(z.zacatek)}, odchod chybí
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p style={{ ...popis, marginBottom: 0 }}>
        {smiOpravit
          ? 'Doplňte odchod ručním zápisem výš — s důvodem, ať je v evidenci poznat, že nevznikl píchnutím.'
          : 'Opravit to může jen ten, kdo spravuje docházku. Řekněte si o to vedoucímu — sami si záznam dopsat nemůžete, jinak by ruční zápis obcházel celý smysl píchání.'}
      </p>
    </section>
  )
}

/** „po 1. 9.“ */
function den(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const dny = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`
}

function cas(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('cs-CZ', { hour: 'numeric', minute: '2-digit' })
}

const panel = {
  background: 'var(--card)',
  border: '1px solid var(--pozor)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--pozor)' } as const

const popis = {
  margin: '8px 0 12px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '66ch',
} as const

const seznam = {
  listStyle: 'none',
  margin: '0 0 4px',
  padding: 0,
  display: 'grid',
  gap: '6px',
} as const

const radek = { fontSize: '14px' } as const
