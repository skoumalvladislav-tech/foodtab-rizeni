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
import Link from 'next/link'

import { hodinaVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { pocet, prisudek } from '@/lib/sklonovani'


export type NedokoncenaProp = {
  employee_id: string
  jmeno: string
  branch_id: string
  business_date: string
  zacatek: string
  moje: boolean
  /** Slug a název pobočky toho záznamu — kvůli odkazu na formulář. */
  pobockaSlug: string | null
  pobockaNazev: string | null
  /** Pásmo té pobočky. Čas začátku se ukazuje v něm, ne v pásmu serveru. */
  zona: string | null
}

export default function PanelNedokoncene({
  zaznamy,
  smiOpravit,
  naPobocce,
}: {
  zaznamy: NedokoncenaProp[]
  smiOpravit: boolean
  /** Jsme na pobočce — formulář ručního zápisu je na téhle obrazovce. */
  naPobocce: boolean
}) {
  if (zaznamy.length === 0) return null

  const moje = zaznamy.filter((z) => z.moje)
  const cizi = zaznamy.filter((z) => !z.moje)

  return (
    <section style={panel}>
      <h2 style={nadpis}>
        {/*
          Celá věta ve třech tvarech, ne jen podstatné jméno. Stálo tu
          „2 záznamy docházky NENÍ dokončených“ — jméno se srovnalo,
          zbytek věty ne.
        */}
        {pocet(zaznamy.length, 'záznam', 'záznamy', 'záznamů')} docházky{' '}
        {prisudek(
          zaznamy.length,
          'není dokončený',
          'nejsou dokončené',
          'není dokončených',
        )}
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
                — příchod {den(z.business_date)} v{' '}
                {cas(z.zacatek, z.zona)}, odchod chybí
                {!naPobocce && z.pobockaNazev ? ` · ${z.pobockaNazev}` : ''}
              </span>
            </span>

            {/*
              Tlačítko u KAŽDÉHO řádku (zadání, body 4 a 8).

              Bez něj stálo v panelu jen „doplňte ručním zápisem výš“ —
              a ten formulář je prázdný. Kdo ho vyplňuje, si musel sám
              zapamatovat člověka i datum a opsat je o kus výš. Nejbližší
              po ruce je „teď“, takže se Šéfík trefil do dneška
              a 31. srpna zůstalo otevřené.

              Na firemní úrovni vede odkaz na POBOČKU toho záznamu —
              formulář se kreslí jen tam a pobočku ten záznam zná.
            */}
            {/*
              next/link, ne holé <a>.

              Šéfík hlásí, že v ostré aplikaci klik nedělal nic — adresa
              se nezměnila. V dev prostředí se to reprodukovat
              nepodařilo, ale holý odkaz, který se od současné adresy
              liší jen dotazem a kotvou, je přesně ten případ, kdy se
              prohlížeč může rozhodnout, že „nikam se nejde".

              next/link o navigaci rozhoduje sám a překreslí obrazovku
              i tehdy, když se cesta nemění. Doskrolování navíc nespoléhá
              na kotvu — dělá si ho formulář sám (viz skok.tsx).
            */}
            {smiOpravit && z.pobockaSlug ? (
              <Link
                href={`/${z.pobockaSlug}/dochazka?doplnit=${z.employee_id}&den=${z.business_date}`}
                className="ft-tl ft-tl-vedlejsi ft-tl-male"
              >
                {naPobocce
                  ? 'Doplnit odchod'
                  : `Doplnit na ${z.pobockaNazev ?? 'pobočce'}`}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <p style={{ ...popis, marginBottom: 0 }}>
        {smiOpravit
          ? 'Doplněný odchod se uloží jako ruční záznam — s důvodem, ať je v evidenci poznat, že nevznikl píchnutím.'
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

/*
  Bez pásma bral `toLocaleTimeString` pásmo serveru — na Vercelu UTC —
  a příchod z 13:27 pražského času se ukazoval jako 11:27. Právě podle
  tohohle údaje se rozhoduje, jaký odchod se dopíše.
*/
function cas(iso: string, zona: string | null): string {
  return hodinaVPasmu(iso, zona ?? ZONA_VYCHOZI)
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

const radek = {
  fontSize: '14px',
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: '10px',
  alignItems: 'center',
  justifyContent: 'space-between',
} as const
