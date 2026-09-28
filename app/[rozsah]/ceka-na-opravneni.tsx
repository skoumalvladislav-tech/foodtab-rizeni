'use client'

import Link from 'next/link'
import { useActionState, useState, useSyncExternalStore } from 'react'

import { akceCekajiciho, popisDuvodu, type Cekajici } from '@/lib/ceka-na-opravneni'
import { odebratZFirmy, type StavOdebrani } from './ceka-akce'

/**
 * Okno „někdo čeká na oprávnění“.
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 3.
 *
 * ---------------------------------------------------------------------
 * PROČ TAK ÚZCE
 *
 * Ukazuje se JEN TEHDY, KDYŽ NĚKDO ČEKÁ. Když pozvánka oprávnění nesla,
 * stačí zvoneček. Okno, které se odklikává, i když není co dělat, se za
 * týden odklikává bez čtení — a pak přijde to jediné, na kterém
 * záleželo, a odklikne se taky.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLA
 *
 *  * Vypíše VŠECHNY čekající, ne jednoho. Po víkendu jich může být pět.
 *  * U každého jméno (z Lidí, jinak e-mail účtu — ne „Nový člověk“),
 *    kontakt a PROČ čeká. Hlášení 25. 9. 2026: z „Nový člověk“ majitel
 *    nepoznal, koho má pustit dál.
 *  * Tlačítko vede rovnou na přidělení oprávnění tomu člověku
 *    (`?opravneni=<id zaměstnance>#opravneni`), ne na seznam lidí. Do
 *    25. 9. vedlo na `?clovek=<id účtu>`, a to Lidé neznaly.
 *  * Kdo v Lidech nemá živý záznam, tomu se oprávnění přidělit nedá —
 *    nabídne se „Odebrat z firmy“ s potvrzením, a u účtu bez záznamu
 *    i „Pozvat z Lidí“ (formulář pozvánky, rovnou rozbalený).
 *  * Zavřít jde vždycky. Nic se tím nerozbije.
 *  * Jakmile lidé oprávnění mají, okno se přestane ukazovat samo —
 *    seznam se bere z dat, nic se neodškrtává.
 *
 * Seznam (`SeznamCekajicich`) je zvlášť, protože se kreslí i v Lidech
 * jako karta — okno se zavře „Teď ne“ a do dalšího přihlášení by jinak
 * nebylo kde čekající najít.
 *
 * ---------------------------------------------------------------------
 * JEDNOU ZA PŘIHLÁŠENÍ
 *
 * Zavření si pamatuje `sessionStorage`, ne databáze. Je to údaj
 * o jednom sezení v jednom prohlížeči a nikam jinam nepatří — a hlavně
 * se tím nezavádí „přečteno“, které by se muselo udržovat. Když sezení
 * skončí, okno se při dalším přihlášení ukáže znovu, přesně jak zadání
 * chce.
 *
 * Čte se přes `useSyncExternalStore`, ne setState v efektu. Je to
 * tentýž případ jako klíč zařízení na kiosku: stav nežije v Reactu, ale
 * v prohlížeči, a dosazovat ho v efektu znamená vykreslit se dvakrát.
 * Server o `sessionStorage` neví, proto se mu odpovídá „zavřeno“ — po
 * připojení se okno objeví.
 */

const KLIC = 'foodtab-ceka-na-opravneni-zavreno'

let posluchaci: (() => void)[] = []

function odebirat(zmena: () => void) {
  posluchaci.push(zmena)
  return () => {
    posluchaci = posluchaci.filter((p) => p !== zmena)
  }
}

function zavrenoKlient(): boolean {
  try {
    return window.sessionStorage.getItem(KLIC) === '1'
  } catch {
    // Prohlížeč s vypnutým úložištěm okno ukáže pokaždé. Lepší než
    // ho neukázat vůbec — je to úkol, ne ozdoba.
    return false
  }
}

function zavrenoServer(): boolean {
  return true
}

export default function CekaNaOpravneni({
  rozsah,
  lide,
}: {
  rozsah: string
  lide: Cekajici[]
}) {
  const zavreno = useSyncExternalStore(odebirat, zavrenoKlient, zavrenoServer)

  if (zavreno || lide.length === 0) return null

  function zavrit() {
    try {
      window.sessionStorage.setItem(KLIC, '1')
    } catch {
      /* Nevadí. Okno se pak ukáže znovu. */
    }
    for (const p of posluchaci) p()
  }

  return (
    <div style={zaclona} role="dialog" aria-modal="true" aria-labelledby="ceka-nadpis">
      <div style={okno}>
        <h2 id="ceka-nadpis" style={nadpis}>
          {lide.length === 1
            ? 'Jeden člověk čeká na oprávnění'
            : `${lide.length} ${lide.length <= 4 ? 'lidé čekají' : 'lidí čeká'} na oprávnění`}
        </h2>

        <p style={popis}>
          Jsou ve firmě, ale zatím nemají odkud vzít ani jedno oprávnění —
          v aplikaci vidí jen své údaje.
        </p>

        <SeznamCekajicich rozsah={rozsah} lide={lide} poOdkazu={zavrit} />

        <div style={{ marginTop: '16px', textAlign: 'right' }}>
          <button type="button" onClick={zavrit} className="ft-tl ft-tl-vedlejsi">
            Teď ne
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Řádky čekajících. V okně i na kartě v Lidech.
 *
 * `poOdkazu`: okno se po kliknutí na odkaz zavře, aby na cílové
 * obrazovce nepřekáželo.
 */
export function SeznamCekajicich({
  rozsah,
  lide,
  poOdkazu,
}: {
  rozsah: string
  lide: Cekajici[]
  poOdkazu?: () => void
}) {
  return (
    <ul style={seznam}>
      {lide.map((c) => {
        const akce = akceCekajiciho(rozsah, c)
        const duvod = popisDuvodu(c)
        return (
          <li key={c.user_id} style={radek} data-ucet={c.user_id}>
            <div style={{ display: 'grid', gap: '2px', minWidth: 0, flex: '1 1 220px' }}>
              <span style={{ fontSize: '15px', color: 'var(--ink)', overflowWrap: 'anywhere' }}>{c.jmeno}</span>
              {c.kontakt && c.kontakt !== c.jmeno ? (
                <span style={maly}>{c.kontakt}</span>
              ) : null}
              {duvod ? <span style={{ fontSize: '13px', color: 'var(--pozor)' }}>{duvod}</span> : null}
              {akce.napoveda ? <span style={maly}>{akce.napoveda}</span> : null}
            </div>

            <div style={tlacitka}>
              {akce.hlavni ? (
                <Link href={akce.hlavni.href} className="ft-tl ft-tl-hlavni" onClick={poOdkazu}>
                  {akce.hlavni.popisek}
                </Link>
              ) : null}
              {akce.vedlejsi ? (
                <Link href={akce.vedlejsi.href} className="ft-tl ft-tl-vedlejsi" onClick={poOdkazu}>
                  {akce.vedlejsi.popisek}
                </Link>
              ) : null}
              {akce.odebrat ? <OdebratZFirmy ucet={c.user_id} jmeno={c.jmeno} /> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Odebrat z firmy. Dva kroky, stejně jako Smazat v Lidech
 * (nastaveni/lide/smazani.tsx): v řádku tiché tlačítko, červené až při
 * otázce, a v otázce věta, co to udělá a jak to vrátit.
 *
 * Formulář s odesílacím tlačítkem existuje AŽ při otázce. Dřív bylo
 * první tlačítko `type="submit"` a otázku zajišťoval jen `onClick` —
 * na kartě v Lidech (kreslí se na serveru) šlo ťuknutím před načtením
 * skriptů odebrat bez otázky (kontrola 28. 9. 2026).
 *
 * Na tlačítku jen „Opravdu odebrat", jméno je ve větě pod ním. Jméno
 * bývá celý e-mail (katarinajiraskova4@gmail.com) a tlačítko se
 * nezalamuje — na telefonu přeteklo z okna i ze stránky.
 *
 * `ptaSeNaZacatku` je pro kontrolu (scripts/ceka-na-opravneni.test.mjs),
 * která bez prohlížeče neumí ťuknout — jako u `CestaVen`.
 */
export function OdebratZFirmy({
  ucet,
  jmeno,
  ptaSeNaZacatku = false,
}: {
  ucet: string
  jmeno: string
  ptaSeNaZacatku?: boolean
}) {
  const [ptameSe, setPtameSe] = useState(ptaSeNaZacatku)
  const [stav, odeslat, ceka] = useActionState<StavOdebrani, FormData>(odebratZFirmy, { stav: 'nic' })

  if (stav.stav === 'hotovo') {
    return <span style={{ fontSize: '13px', color: 'var(--dobre)' }}>Odebráno z firmy.</span>
  }

  if (!ptameSe) {
    return (
      <div style={{ display: 'grid', gap: '6px', justifyItems: 'start' }}>
        <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setPtameSe(true)}>
          Odebrat z firmy
        </button>
        {stav.stav === 'chyba' ? (
          <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
            {stav.text}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form action={odeslat} style={{ display: 'grid', gap: '6px', justifyItems: 'start', minWidth: 0 }}>
      <input type="hidden" name="ucet" value={ucet} />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={ceka} className="ft-tl ft-tl-nebezpecne">
          {ceka ? 'Odebírám…' : 'Opravdu odebrat'}
        </button>
        {!ceka ? (
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setPtameSe(false)}>
            Zpět
          </button>
        ) : null}
      </div>
      <p aria-live="polite" style={{ ...maly, margin: 0, maxWidth: '38ch' }}>
        {jmeno} přestane do firmy vidět. Nic se nemaže — novou pozvánkou se
        dá vrátit.
      </p>
      {stav.stav === 'chyba' ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {stav.text}
        </p>
      ) : null}
    </form>
  )
}

/*
  `minmax(0, …)` a `minWidth: 0`: položka mřížky i flexu se jinak
  nezúží pod šířku svého obsahu — a jedno dlouhé slovo (e-mail) pak
  roztáhne okno přes okraj telefonu (kontrola 28. 9. 2026).
*/
const zaclona = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 60,
  background: 'rgba(0,0,0,.45)',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 560px)',
  placeContent: 'center',
  placeItems: 'center',
  padding: '20px',
}

const okno = {
  width: '100%',
  minWidth: 0,
  maxWidth: '560px',
  // Po víkendu jich může být pět, každý se dvěma řádky vysvětlení —
  // okno se na telefonu nesmí vysunout za obrazovku.
  maxHeight: 'calc(100vh - 40px)',
  overflowY: 'auto' as const,
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '20px',
}

const nadpis = { margin: '0 0 8px', fontSize: '18px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13.5px',
  color: 'var(--muted)',
  lineHeight: 1.5,
  maxWidth: '52ch',
} as const

const seznam = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '8px',
} as const

const radek = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap' as const,
  padding: '10px 0',
  borderTop: '1px solid var(--line)',
}

const tlacitka = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  minWidth: 0,
  maxWidth: '100%',
}

const maly = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
  overflowWrap: 'anywhere' as const,
} as const
