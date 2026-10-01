import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KBELIK, PLATNOST_ODKAZU_S } from '@/lib/marketing-media'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import ZnackaFormular from './formular'

export const dynamic = 'force-dynamic'

/**
 * Značka provozovny — barvy, písmo, podpis, tón hlasu, popis a odkazy
 * na web a sociální sítě.
 *
 * Zadání: docs/marketing-je-modul.md; návrh z webu podle zadání Šéfíka
 * 1. 10. 2026 (`app/[rozsah]/marketing/znacka/akce-ai.ts`).
 *
 * Rozsah se řídí adresou: na pobočce se ukládá značka pobočky, na
 * firemní úrovni firemní. Pobočková přebíjí firemní — rozhoduje o tom
 * `public.marketing_znacka` v databázi, ne tahle obrazovka.
 *
 * Prázdné pole znamená „nezadáno", ne prázdná hodnota. Návrh si to
 * nedomýšlí: co tu není, do příspěvku nepatří.
 *
 * Vlastní formulář (vč. tlačítka „Najít na webu“) je v `./formular.tsx`
 * — klientská komponenta, protože návrh z webu musí po úspěchu
 * předvyplnit stav TÉHOŽ formuláře, který se ukládá přes `ulozitZnacku`.
 */

type Znacka = {
  ton_hlasu: string
  pouzivat_emoji: boolean
  barva_hlavni: string | null
  barva_doplnkova: string | null
  barva_pozadi: string | null
  pismo_nadpisy: string | null
  pismo_text: string | null
  podpis: string
  kontakt: string
  vyrazy_ano: string[]
  vyrazy_ne: string[]
  video_sekundy: number
  popis_firmy: string
  web_url: string
  instagram_url: string
  facebook_url: string
  logo_media_id: string | null
}

export default async function ZnackaStranka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { ulozeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  /*
    Sloupce se musí psát jako ŘETĚZCOVÝ LITERÁL přímo v `.select(...)`,
    ne poskládané do proměnné: Supabase typuje výsledek podle PŘESNĚHO
    literálu, který `.select()` dostane, a za proměnnou typ nedohledá
    (prošlo by to za běhu, ale TypeScript by result typoval jako
    neurčitou chybu — chytil to `npx tsc --noEmit`, ne úvaha).
  */
  const dotaz = branchId === null
    ? supabase.from('marketing_nastaveni')
        .select('ton_hlasu, pouzivat_emoji, barva_hlavni, barva_doplnkova, barva_pozadi, pismo_nadpisy, pismo_text, podpis, kontakt, vyrazy_ano, vyrazy_ne, video_sekundy, popis_firmy, web_url, instagram_url, facebook_url, logo_media_id')
        .eq('tenant_id', tenantId).is('branch_id', null).maybeSingle()
    : supabase.from('marketing_nastaveni')
        .select('ton_hlasu, pouzivat_emoji, barva_hlavni, barva_doplnkova, barva_pozadi, pismo_nadpisy, pismo_text, podpis, kontakt, vyrazy_ano, vyrazy_ne, video_sekundy, popis_firmy, web_url, instagram_url, facebook_url, logo_media_id')
        .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle()

  const odpoved = await dotaz
  if (tabulkaNeexistuje(odpoved.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Značka</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Čeká se na nasazení databáze">
            Tabulky modulu zatím nejsou nasazené. Až proběhnou migrace,
            obrazovka se rozjede sama.
          </Sdeleni>
        </div>
      </>
    )
  }

  const z = await jeden<Znacka>('značka provozovny', Promise.resolve(odpoved))

  // Kdo smí jen číst, vidí totéž, ale nemůže uložit. Skrytý formulář by
  // byl horší: člověk by nevěděl, proč to nejde.
  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'

  const kdeJsme = pristup.scope.branchName ?? 'celá firma'

  /*
    Náhled aktuálního loga — stejný vzor jako knihovna fotek
    (app/[rozsah]/marketing/media/page.tsx): kbelík je soukromý, takže
    adresa souboru samotná nikam nevede a musí se podepsat.
  */
  let logoNahled: string | null = null
  if (z?.logo_media_id) {
    const logo = await jeden<{ cesta: string }>(
      'cesta k logu',
      supabase.from('marketing_media').select('cesta').eq('id', z.logo_media_id).maybeSingle(),
    ).catch(() => null)

    if (logo) {
      const podepsano = await supabase.storage.from(KBELIK).createSignedUrl(logo.cesta, PLATNOST_ODKAZU_S)
      logoNahled = podepsano.data?.signedUrl ?? null
    }
  }

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={
          branchId === null
            ? 'Firemní značka. Pobočka si ji může přebít vlastní.'
            : `Značka provozovny ${kdeJsme}. Co tu nevyplníte, se vezme z firemní.`
        }
      >
        Značka
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px', display: 'grid', gap: '16px' }}>
        {ulozeno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p>
        ) : null}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <ZnackaFormular
          rozsah={rozsah}
          smiMenit={smiMenit}
          znacka={z}
          logoMediaId={z?.logo_media_id ?? null}
          logoNahled={logoNahled}
        />

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}
