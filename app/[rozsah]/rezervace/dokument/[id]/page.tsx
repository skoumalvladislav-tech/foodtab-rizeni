import Link from 'next/link'
import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { DokumentNecitelny, precistDocx, type NahledDocx } from '@/lib/docx-nahled'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { denKratce } from '@/lib/rezervace-kalendar'
import { otevritVProhlizeci } from '@/lib/rezervace-prilohy'
import { bezpecnaZpatky } from '@/lib/rezervace-typy'

import { nacistPrilohu, nacistRezervaci, stahnoutPrilohu } from '../../data'
import { zkusPristupRezervacim } from '../../pristup'
import { casRezervace, titulek } from '../../prvky'
import { DokumentObsah } from '../obsah'

export const dynamic = 'force-dynamic'

const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Náhled dokumentu Word přiloženého k rezervaci nebo ke dni.
 *
 * Proč: prohlížeč .docx neotevře, jen ho stáhne — a na počítači to
 * vypadalo, že se po kliknutí nic nestalo (Šéfík 2. 11. 2026, „soubory
 * teď nejdou otevřít“). Tady se text dokumentu přečte na serveru
 * (lib/docx-nahled.ts) a ukáže jako stránka; originál jde stáhnout
 * tlačítkem přes /api/rezervace/soubor/[id].
 *
 * Přístup stejně jako detail rezervace: prvním krokem
 * `zkusPristupRezervacim`, příloha jen z poboček rozsahu, soubor
 * uživatelským klientem (politika kbelíku je druhá linie). PDF a fotka
 * sem nepatří — ty prohlížeč otevře sám, tak se přesměrují na soubor.
 * Kreslí ../obsah.tsx.
 */
export default async function RezervaceDokument({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; id: string }>
  searchParams: Promise<{ zpet?: string | string[] }>
}) {
  const { rozsah, id } = await params
  const { zpet: zpetText } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const priloha = VZOR_ID.test(id) ? await nacistPrilohu(tenantId, id, pristup.pobocky) : null
  const pobocka = priloha ? pristup.pobocky.find((p) => p.id === priloha.branch_id) : undefined
  if (!priloha || !pobocka) {
    return (
      <Sdeleni nadpis="Dokument tu není">
        Buď ho někdo smazal, nebo patří pobočce, kterou v tomhle rozsahu nevidíte.{' '}
        <Link href={`/${rozsah}/rezervace`}>Zpět na kalendář</Link>
      </Sdeleni>
    )
  }
  if (otevritVProhlizeci(priloha.mime)) redirect(`/api/rezervace/soubor/${priloha.id}`)

  // K čemu dokument patří — do popisu a do odkazu zpátky.
  const rezervace = priloha.rezervace_id ? await nacistRezervaci(tenantId, priloha.rezervace_id, pristup.pobocky) : null
  const r = rezervace?.radek
  const kCemu = r
    ? `${titulek(r)} · ${denKratce(r.den)} · ${casRezervace(r, r.zona)}`
    : priloha.den
      ? `ke dni ${denKratce(priloha.den)}`
      : null
  // Otevřený z kalendáře (týden, den) se vrací do kalendáře — z aplikace
  // na ploše iPhonu jiná cesta zpátky než tenhle odkaz není. Jen adresa
  // uvnitř Rezervací téhož rozsahu (bezpecnaZpatky), jinak by vedl kamkoli.
  const zKalendare = typeof zpetText === 'string' && zpetText !== '' ? bezpecnaZpatky(rozsah, zpetText) : null
  const zpet = zKalendare
    ? { href: zKalendare, text: zKalendare.startsWith(`/${rozsah}/rezervace/den/`) ? 'Zpět na den' : 'Zpět na kalendář' }
    : r
      ? { href: `/${rozsah}/rezervace/${r.id}`, text: 'Zpět na rezervaci' }
      : priloha.den
        ? { href: `/${rozsah}/rezervace/den/${priloha.den}`, text: 'Zpět na den' }
        : { href: `/${rozsah}/rezervace`, text: 'Zpět na kalendář' }

  let nahled: NahledDocx | null = null
  let chyba: string | null = null
  const bajty = await stahnoutPrilohu(priloha.cesta)
  if (!bajty) {
    chyba = 'Soubor se teď nepodařilo načíst z úložiště.'
  } else {
    try {
      nahled = precistDocx(bajty)
    } catch (e) {
      if (!(e instanceof DokumentNecitelny)) throw e
      chyba = e.message
    }
  }

  return (
    <DokumentObsah
      rozsah={rozsah}
      priloha={priloha}
      zona={pobocka.zona}
      kCemu={kCemu}
      zpet={zpet}
      nahled={nahled}
      chyba={chyba}
    />
  )
}
