import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import PrijmoutPozvanku from './prijmout-pozvanku'

/**
 * „Máte čekající pozvánku.“
 *
 * Zadání: docs/ukoly-codea-drobnosti-2026-09-01.md, bod 7a.
 *
 * Šéfík se přihlásil adresou, na kterou mu hodinu předtím přišla
 * pozvánka, a aplikace mu poradila, ať si o pozvánku požádá. Tohle
 * zažije každý nový zaměstnanec — je to první obrazovka aplikace.
 *
 * Hledá se podle adresy přihlášeného účtu, ne podle tokenu z odkazu:
 * kdo se přihlásil tou správnou adresou, prošel přesně tou kontrolou,
 * kterou pozvánka dělá.
 *
 * Vrací `null`, když nic nečeká — volající pak ukáže své vlastní
 * vysvětlení. Nenasazená migrace se chová stejně jako „nic nečeká“:
 * obrazovka vypadá jako dosud, nespadne.
 */

export type Cekajici = {
  invitation_id: string
  tenant_id: string
  firma: string
  kanal: string
  expires_at: string
}

export async function nactiCekajici(): Promise<Cekajici[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('moje_cekajici_pozvanky')
  if (error) {
    if (funkceNeexistuje(error)) return []
    throw error
  }
  return (data ?? []) as Cekajici[]
}

export default function CekajiciPozvanka({
  pozvanky,
}: {
  pozvanky: Cekajici[]
}) {
  if (pozvanky.length === 0) return null

  const jedna = pozvanky.length === 1

  return (
    <main style={obal}>
      <div style={karta}>
        <h1 style={nadpis}>
          {jedna
            ? `Máte čekající pozvánku do firmy ${pozvanky[0].firma}`
            : 'Máte čekající pozvánky'}
        </h1>

        <p style={popis}>
          Přihlásili jste se adresou, na kterou pozvánka přišla — víc už
          není potřeba. Odkaz z e-mailu hledat nemusíte.
        </p>

        <div style={{ display: 'grid', gap: '10px' }}>
          {pozvanky.map((p) => (
            <PrijmoutPozvanku
              key={p.invitation_id}
              id={p.invitation_id}
              firma={p.firma}
              jedina={jedna}
            />
          ))}
        </div>

        <p style={{ ...popis, margin: '18px 0 0', fontSize: '12.5px' }}>
          Po přijetí uvidíte to, co vám ve firmě přidělili. Když ještě
          nic, řekne vám to obrazovka — a ozve se, až se to změní.
        </p>
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
  maxWidth: '480px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '32px',
} as const

const nadpis = {
  margin: '0 0 12px',
  fontSize: '20px',
  color: 'var(--branch)',
  lineHeight: 1.3,
} as const

const popis = {
  margin: '0 0 18px',
  color: 'var(--muted)',
  fontSize: '14px',
  lineHeight: 1.55,
} as const
