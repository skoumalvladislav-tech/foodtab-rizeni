import Link from 'next/link'

import { pichnoutKodem } from './akce'

/**
 * Jedno ťuknutí po načtení QR.
 *
 * Příchod i odchod jsou hlavní akce, ne varování — člověk u dveří neví
 * dopředu, kterou zrovna mačká, a obě jsou stejně běžné. Rozhoduje se
 * jedním ťuknutím, protože kód už je v adrese.
 */
export default function FormularPichnuti({
  kod,
  hotovo,
  chyba,
}: {
  kod: string
  hotovo?: string
  chyba?: string
}) {
  const [druh, pobocka, mimo] = (hotovo ?? '').split('|')

  return (
    <main style={obal}>
      <div style={karta}>
        {hotovo ? (
          <>
            <h1 style={nadpis}>
              {druh === 'odchod' ? 'Odchod zapsaný' : 'Příchod zapsaný'}
            </h1>
            <p style={popis}>
              {pobocka ? <strong>{pobocka}</strong> : null}
              {mimo === 'mimo' ? (
                <>
                  {' '}
                  — dnes tu nemáte směnu v rozpisu, takže je záznam
                  označený jako <strong>mimo rozpis</strong>. Zapsaný je
                  normálně.
                </>
              ) : null}
            </p>
            <Link href="/" className="ft-tl ft-tl-vedlejsi" style={tlacitko}>
              Do aplikace
            </Link>
          </>
        ) : (
          <>
            <h1 style={nadpis}>Píchnutí</h1>
            <p style={popis}>
              Kód z tabletu máte načtený. Ťukněte na to, co zrovna děláte.
            </p>

            {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

            <div style={{ display: 'grid', gap: '10px' }}>
              <form action={pichnoutKodem}>
                <input type="hidden" name="kod" value={kod} />
                <input type="hidden" name="druh" value="in" />
                <button type="submit" className="ft-tl ft-tl-hlavni" style={tlacitko}>
                  Příchod
                </button>
              </form>

              <form action={pichnoutKodem}>
                <input type="hidden" name="kod" value={kod} />
                <input type="hidden" name="druh" value="out" />
                <button type="submit" className="ft-tl ft-tl-vedlejsi" style={tlacitko}>
                  Odchod
                </button>
              </form>
            </div>

            <p style={{ ...popis, margin: '16px 0 0', fontSize: '12.5px' }}>
              Kód na tabletu se mění každou minutu. Když to nevyjde,
              načtěte ho znovu — vyfocený je za chvíli k ničemu, a to je
              celý jeho smysl.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: 'var(--paper)',
} as const

const karta = {
  width: '100%',
  maxWidth: '420px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '28px',
} as const

const nadpis = { margin: '0 0 10px', fontSize: '24px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 18px',
  fontSize: '14px',
  color: 'var(--muted)',
  lineHeight: 1.55,
} as const

const tlacitko = {
  width: '100%',
  minHeight: '56px',
  fontSize: '18px',
} as const
