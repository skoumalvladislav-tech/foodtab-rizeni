import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'
import FormularPichnuti from './formular'

export const dynamic = 'force-dynamic'

/**
 * Píchnutí kódem z QR.
 *
 * Sem vede QR kód z tabletu (docs/kiosek-pin-zalohy-zadani.md,
 * uspořádání A). Telefon adresu otevře, kód je v ní — člověk už jen
 * potvrdí příchod nebo odchod.
 *
 * ---------------------------------------------------------------------
 * PROČ SE NEPÍCHNE SAMO PŘI NAČTENÍ
 *
 * Zadání říká „aby telefon po načtení rovnou píchl, ne aby jen ukázal
 * text“ — proti QR, ve kterém by byl jen kód k opsání. Píchnout přímo
 * při otevření adresy by ale znamenalo zapisovat docházku na GET:
 * prohlížeč si stránku předběžně načte, člověk ji obnoví, vrátí se
 * tlačítkem zpět. Pokaždé jiný záznam.
 *
 * Zůstává tedy jedno ťuknutí — ale nic se neopisuje a nevybírá.
 * Odchylka od doslovného znění; je v ranní zprávě.
 */
export default async function Pichnout({
  searchParams,
}: {
  searchParams: Promise<{ kod?: string; hotovo?: string; chyba?: string }>
}) {
  const { kod, hotovo, chyba } = await searchParams

  const user = await getUser()
  if (!user) {
    // Po přihlášení se člověk vrátí sem i s kódem. Kód je krátkodobý,
    // takže když mezitím vyprší, obrazovka to řekne a on načte nový.
    redirect(`/prihlaseni?dal=${encodeURIComponent(`/pichnout?kod=${kod ?? ''}`)}`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Píchat může jen člen firmy. Až vás někdo pozve, přijde vám e-mail
        s odkazem.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return (
      <Sdeleni samostatne nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    )
  }

  if (!kod) {
    return (
      <Sdeleni samostatne nadpis="Chybí kód">
        Tahle adresa se otevírá načtením QR kódu z tabletu na provozovně.
        Kód se v ní nese s sebou — bez něj není co píchnout.
      </Sdeleni>
    )
  }

  return <FormularPichnuti kod={kod} hotovo={hotovo} chyba={chyba} />
}
