import { redirect } from 'next/navigation'
import Link from 'next/link'

import { ZONA_VYCHOZI, denVPasmu } from '@/lib/cas'
import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { modelovyPoskytovatel, vybratPoskytovateleNavrhu } from '@/lib/komunikace/navrh-ukolu'
import { popisStavuPrepisu } from '@/lib/komunikace/prepis'
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import PcZalozky from '../../../provozni-centrum/zalozky'
import { zalozitUkolZeZpravy } from './akce'
import FormularUkolu from './formular-ukolu'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ZpravaProUkol = {
  id: string
  text: string | null
  zvuk_cesta?: string | null
  vytvoreno_kdy: string
  stornovano_kdy: string | null
}

/**
 * Jedna zpráva rozhovoru. Sloupec `zvuk_cesta` je z pozdější migrace — dokud
 * v databázi není, čte se jen text a hlasovka se pozná jen po nasazení.
 */
async function nactiZpravu(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  konverzace: string,
  zpravaId: string,
): Promise<ZpravaProUkol | null> {
  const dotaz = (sloupce: string) =>
    supabase
      .from('konverzace_zpravy')
      .select(sloupce)
      .eq('id', zpravaId)
      .eq('konverzace_id', konverzace)
      .maybeSingle()

  let { data, error } = await dotaz('id, text, zvuk_cesta, vytvoreno_kdy, stornovano_kdy')
  if (error && sloupecNeexistuje(error)) {
    ;({ data, error } = await dotaz('id, text, vytvoreno_kdy, stornovano_kdy'))
  }
  if (error) throw new DotazSelhal('zpráva pro úkol', error)
  return (data as unknown as ZpravaProUkol | null) ?? null
}

/**
 * Úkol ze zprávy — formulář s předvyplněným návrhem.
 *
 * NÁVRH SESTAVUJE PRAVIDLOVÝ NÁSTROJ V APLIKACI, ne jazykový model
 * (CLAUDE.md, pravidlo 8: z komunikace se nic neposílá modelu). Text zprávy
 * neopouští server a člověk to má na obrazovce napsané. Návrh je jen
 * předvyplnění — úkol vznikne až odesláním formuláře, a co je nejasné
 * (termín), je označené k ověření.
 *
 * Právo zakládat úkoly (tasks.manage) se kontroluje tady i v databázi; kdo
 * ho nemá, formulář neuvidí.
 */
export default async function UkolZeZpravy({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; konverzace: string }>
  searchParams: Promise<{ zprava?: string; chyba?: string }>
}) {
  const { rozsah, konverzace } = await params
  const { zprava, chyba } = await searchParams

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return <Sdeleni nadpis="Firmu se nepodařilo načíst">Zkuste to prosím za chvíli znovu.</Sdeleni>
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) {
    return <Sdeleni nadpis="Sem nemáte přístup">Tahle část Foodtabu vám není otevřená.</Sdeleni>
  }

  const zpet = `/${rozsah}/vzkazy/${konverzace}`

  if (!UUID.test(konverzace)) {
    return (
      <Sdeleni nadpis="Tenhle rozhovor neexistuje">
        Odkaz není platný. <Link href={`/${rozsah}/vzkazy`}>Zpět na rozhovory</Link>.
      </Sdeleni>
    )
  }

  if (!(await hasAccess(tenantId, 'tasks.manage', scope.branchId))) {
    return (
      <Sdeleni nadpis="Úkol zadat nemůžete">
        Zadávat úkoly smí jen ten, kdo má na to oprávnění. <Link href={zpet}>Zpět do rozhovoru</Link>.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  // Zpráva: RLS pustí jen účastníka rozhovoru, ostatním vrátí prázdno.
  // Neplatné id z adresy se tváří jako cizí zpráva — nedá se zkoušet.
  const z = UUID.test(zprava ?? '') ? await nactiZpravu(supabase, konverzace, zprava as string) : null

  if (!z || z.stornovano_kdy) {
    return (
      <Sdeleni nadpis="Tuhle zprávu nejde použít">
        Zpráva neexistuje, byla stažená, nebo k ní nemáte přístup.{' '}
        <Link href={zpet}>Zpět do rozhovoru</Link>.
      </Sdeleni>
    )
  }

  const text = String(z.text ?? '').trim()
  const jeHlasovka = Boolean(z.zvuk_cesta)
  const dnesSkutecne = denVPasmu(new Date(), ZONA_VYCHOZI)
  // „Zítra“ a „v pátek“ se počítají od dne, kdy byla ZPRÁVA napsaná, ne od dneška:
  // zpráva z pondělí „zítra přijede dodavatel“ myslí úterý, i když se úkol zakládá ve čtvrtek.
  const denZpravy = denVPasmu(z.vytvoreno_kdy, ZONA_VYCHOZI)

  const poskytovatel = vybratPoskytovateleNavrhu()
  let navrh = text !== '' ? await poskytovatel.navrhnout({ text, dnes: denZpravy }) : null
  if (navrh?.termin && navrh.termin.datum < dnesSkutecne) {
    // Termín odvozený od staré zprávy už mohl uplynout — nevydává se za jistý.
    navrh = {
      ...navrh,
      vyzadujeKontrolu: [...new Set([...navrh.vyzadujeKontrolu, 'termin' as const])],
      nalezy: [...navrh.nalezy, 'Navržený termín už uplynul (zpráva je starší) — ověřte ho.'],
    }
  }
  const stavModelu = modelovyPoskytovatel.stav()

  // Adresáti. Úseky a pozice čte každý člen firmy; lidi dává `komu_muzu_psat`
  // (jen s účtem — úkol pro někoho bez účtu by nikoho nenotifikoval).
  const [{ data: usekyData, error: chybaUseky }, { data: poziceData, error: chybaPozice }, lideOdpoved] = await Promise.all([
    supabase.from('useky').select('id, nazev').eq('tenant_id', tenantId).eq('active', true).order('poradi', { ascending: true }),
    supabase.from('positions').select('id, label').eq('tenant_id', tenantId).eq('active', true).order('label', { ascending: true }),
    supabase.rpc('komu_muzu_psat', { p_tenant: tenantId }),
  ])
  // Bez migrace (funkce není) se formulář vůbec nenabízí — o chybějící
  // `zalozit_ukol_ze_zpravy` by se člověk dozvěděl až po odeslání. Jakákoli
  // JINÁ chyba se vyhazuje: prázdný seznam lidí by vypadal jako správně
  // vykreslený formulář s prázdným výběrem.
  if (lideOdpoved.error && funkceNeexistuje(lideOdpoved.error)) {
    return (
      <Sdeleni nadpis="Úkol ze zprávy čeká na nasazení databáze">
        Bude fungovat po nasazení migrace <code>20260921110000_provozni_centrum</code>.{' '}
        <Link href={zpet}>Zpět do rozhovoru</Link>.
      </Sdeleni>
    )
  }
  if (lideOdpoved.error) throw new DotazSelhal('seznam kolegů', lideOdpoved.error)
  if (chybaUseky) throw new DotazSelhal('úseky', chybaUseky)
  if (chybaPozice) throw new DotazSelhal('pozice', chybaPozice)
  const lide = (lideOdpoved.data ?? []) as { employee_id: string; jmeno: string }[]

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Zkontrolujte návrh a potvrďte. Úkol vznikne až po odeslání."
        vpravo={
          <Link href={zpet} className="ft-tl">
            Zpět do rozhovoru
          </Link>
        }
      >
        Úkol ze zprávy
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        <PcZalozky rozsah={rozsah} aktivni="komunikace" />

        {scope.branchId === null ? (
          <p className="pc-poznamka-navrhu">
            Jste v rozsahu „Celá firma“: úkol s <strong>termínem</strong> zadejte na konkrétní pobočce
            (přepněte pobočku nahoře) — bez pobočky by se termín ztratil a databáze úkol odmítne.
          </p>
        ) : null}

        <FormularUkolu
          akce={zalozitUkolZeZpravy}
          rozsah={rozsah}
          konverzace={konverzace}
          zpravaId={z.id}
          citat={text}
          vytvoreno={z.vytvoreno_kdy}
          jeHlasovka={jeHlasovka}
          navrh={navrh}
          duvodBezModelu={stavModelu.dostupny ? null : stavModelu.duvod}
          poznamkaKPrepisu={popisStavuPrepisu(null).text}
          chyba={chyba ?? null}
          lide={lide}
          useky={(usekyData ?? []).map((u) => [u.id as string, String(u.nazev)] as [string, string])}
          pozice={(poziceData ?? []).map((p) => [p.id as string, String(p.label)] as [string, string])}
          zpet={zpet}
        />
      </div>
    </>
  )
}
