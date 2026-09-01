import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { zkratitAdresu } from '@/lib/adresa'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import PrijmoutPozvankuFormular from './prijeti'

export const dynamic = 'force-dynamic'

/**
 * Přijetí pozvánky.
 *
 * Pozvaný si vezme odkaz z e-mailu a otevře tuhle stránku. Kdo není
 * přihlášený, jde nejdřív na přihlášení; o platnosti tokenu rozhoduje
 * až `app.accept_invitation`, kde na to jsou všechny kontroly
 * pohromadě.
 *
 * Název firmy a zkrácená adresa se načtou dopředu, aby obrazovka věděla,
 * co člověku nabídnout, když je přihlášený pod jinou adresou (bod 6).
 * Do prohlížeče jde adresa JEN ZKRÁCENÁ — celá by se dala přečíst přes
 * rameno a kdo pozvánku otevřel, ji stejně zná z e-mailu.
 */
export default async function PrijmoutPozvankuPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('pozvanka_info', { p_token: token })
  if (error && !funkceNeexistuje(error)) throw error

  const info = (data as { firma: string; kanal: string; kontakt: string; stav: string }[])?.[0]

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'var(--paper)',
      }}
    >
      <div style={{ maxWidth: '420px', width: '100%' }}>
        <h1 style={{ fontSize: '24px', letterSpacing: '-.02em', margin: '0 0 8px' }}>
          {info?.firma ? `Pozvánka do firmy ${info.firma}` : 'Pozvánka do firmy'}
        </h1>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--muted)',
            margin: '0 0 28px',
            lineHeight: 1.55,
          }}
        >
          {popisStavu(info?.stav)}
        </p>

        <PrijmoutPozvankuFormular
          token={token}
          adresaZkracena={
            info?.kanal === 'email' ? zkratitAdresu(info.kontakt) : null
          }
        />
      </div>
    </main>
  )
}

/**
 * Co je s pozvánkou. Dřív tu stálo „potvrďte svou pozvánku“ i u té,
 * která už byla použitá nebo propadlá — člověk klikl a teprve pak se
 * dozvěděl, že nemá co potvrzovat.
 */
function popisStavu(stav: string | undefined): string {
  switch (stav) {
    case 'pouzita':
      return 'Tahle pozvánka už byla použitá. Pokud jste ji přijali vy, stačí se přihlásit.'
    case 'zrusena':
      return 'Tahle pozvánka byla zrušená. Požádejte o novou toho, kdo firmu spravuje.'
    case 'propadla':
      return 'Téhle pozvánce vypršela platnost. Požádejte o novou toho, kdo firmu spravuje.'
    case 'ok':
      return 'Abyste mohli pokračovat, potvrďte svou pozvánku.'
    default:
      // Nenasazená migrace nebo token, který nikam nevede. Rozhodne
      // až přijetí — ta kontrola je na jednom místě a je úplná.
      return 'Abyste mohli pokračovat, potvrďte svou pozvánku.'
  }
}
