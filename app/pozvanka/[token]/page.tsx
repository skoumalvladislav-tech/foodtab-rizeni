import Link from 'next/link'
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
 *
 * STAVY, které tato stránka musí zvládnout česky a s cestou ven (bod 7):
 *
 *   ok          → formulář přijetí (standardní případ)
 *   pouzita     → informace + tlačítko „Přihlásit se”
 *   zrusena     → informace, žádná akce (musí požádat správce o novou)
 *   propadla    → informace, žádná akce (musí požádat správce o novou)
 *   nicostatni  → poškozený odkaz, žádná akce
 *   jiný účet   → řeší se v PrijmoutPozvankuFormular po prvním kliknutí
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

  // Terminální stavy: pozvánku přijmout nejde, formulář by byl slepá ulička.
  const stavKonecny =
    info?.stav === 'pouzita' || info?.stav === 'zrusena' || info?.stav === 'propadla'
  // Token neexistuje v DB ani jako propadlý — poškozený nebo zkrácený odkaz.
  const stavNicNenaslo = !info

  const nadpis = info?.firma ? `Pozvánka do firmy ${info.firma}` : 'Pozvánka'

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
          {nadpis}
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

        {/*
          Terminální stavy: místo formuláře cestu ven.

          „Použitá” nabízí přihlášení — kdo přijal svou vlastní pozvánku
          a vrátil se sem z bookmarka, má co odkliknout.

          „Zrušená” a „propadlá” nemají žádnou akci: bez nové pozvánky od
          správce tady není co udělat. Text to říká a telefonát se nevyhne.

          „Nic nenaslo” (poškozený token) taky nemá akci — správce musí
          poslat novou, protože token v DB prostě není.
        */}
        {stavKonecny || stavNicNenaslo ? (
          <CestaVen stav={info?.stav} />
        ) : (
          <PrijmoutPozvankuFormular
            token={token}
            adresaZkracena={
              info?.kanal === 'email' ? zkratitAdresu(info.kontakt) : null
            }
          />
        )}
      </div>
    </main>
  )
}

/** Cestu ven z terminálního stavu — bez formuláře. */
function CestaVen({ stav }: { stav: string | undefined }) {
  if (stav === 'pouzita') {
    return (
      <Link href='/prihlaseni' className='ft-tl ft-tl-hlavni' style={{ display: 'inline-block' }}>
        Přihlásit se
      </Link>
    )
  }
  // zrusena, propadla, undefined (poškozený odkaz) — žádná akce.
  return null
}

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
      // Token v databázi neexistuje — zkrácený nebo poškozený odkaz.
      return 'Tenhle odkaz nevede k žádné pozvánce. Zkontrolujte, jestli jste ho zkopírovali celý, nebo požádejte o novou pozvánku.'
  }
}
