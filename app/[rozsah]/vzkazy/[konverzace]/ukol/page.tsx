import { redirect } from 'next/navigation'
import Link from 'next/link'

import { ZONA_VYCHOZI, datumACasVPasmu, denVPasmu } from '@/lib/cas'
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
  const dnes = denVPasmu(new Date(), ZONA_VYCHOZI)

  const poskytovatel = vybratPoskytovateleNavrhu()
  const navrh = text !== '' ? await poskytovatel.navrhnout({ text, dnes }) : null
  const kontrolaTerminu = navrh?.vyzadujeKontrolu.includes('termin') ?? false
  const stavModelu = modelovyPoskytovatel.stav()

  // Adresáti. Úseky a pozice čte každý člen firmy; lidi dává `komu_muzu_psat`
  // (jen s účtem — úkol pro někoho bez účtu by nikoho nenotifikoval).
  const [{ data: usekyData }, { data: poziceData }, lideOdpoved] = await Promise.all([
    supabase.from('useky').select('id, nazev').eq('tenant_id', tenantId).eq('active', true).order('poradi', { ascending: true }),
    supabase.from('positions').select('id, label').eq('tenant_id', tenantId).eq('active', true).order('label', { ascending: true }),
    supabase.rpc('komu_muzu_psat', { p_tenant: tenantId }),
  ])
  const lide =
    lideOdpoved.error && !funkceNeexistuje(lideOdpoved.error)
      ? []
      : ((lideOdpoved.data ?? []) as { employee_id: string; jmeno: string }[])

  const naTerminu = navrh?.termin ?? null

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

        <section className="ds-plocha" style={{ maxWidth: '720px' }}>
          {chyba ? (
            <p className="hlaska-chyba" role="alert" style={{ margin: '0 0 14px' }}>
              {chyba}
            </p>
          ) : null}

          <blockquote
            style={{
              margin: '0 0 16px', padding: '10px 14px', borderLeft: '3px solid var(--line-2)',
              background: 'var(--sunken)', borderRadius: '0 10px 10px 0', fontSize: '14px', lineHeight: 1.5,
            }}
          >
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '2px' }}>
              Zpráva z {datumACasVPasmu(z.vytvoreno_kdy, ZONA_VYCHOZI)}
            </span>
            {text !== '' ? text : jeHlasovka ? 'Hlasová zpráva.' : ''}
          </blockquote>

          <form action={zalozitUkolZeZpravy} className="pc-formular">
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="konverzace" value={konverzace} />
            <input type="hidden" name="zprava" value={z.id} />

            <div className="pc-poznamka-navrhu">
              {navrh ? (
                <>
                  <strong>Návrh sestavil pravidlový nástroj v aplikaci.</strong> Text zprávy nikam
                  neodešel. Cokoli tu můžete změnit.
                  {navrh.nalezy.length > 0 ? (
                    <ul>
                      {navrh.nalezy.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : (
                    <> Ve zprávě se nepoznal žádný termín ani naléhavost.</>
                  )}
                </>
              ) : (
                <>
                  <strong>Návrh se nesestavil.</strong>{' '}
                  {jeHlasovka
                    ? `Hlasová zpráva nemá text. ${popisStavuPrepisu(null).text} Vyplňte úkol ručně.`
                    : 'Zpráva nemá text, ze kterého by se dal návrh udělat. Vyplňte úkol ručně.'}
                </>
              )}
              {!stavModelu.dostupny ? (
                <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                  Návrh jazykovým modelem zapnutý není. {stavModelu.duvod}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="uk-nazev">Název úkolu</label>
              <input
                id="uk-nazev"
                type="text"
                name="nazev"
                required
                maxLength={120}
                defaultValue={navrh?.nazev ?? ''}
              />
            </div>

            <div>
              <label htmlFor="uk-poznamka">Poznámka (nepovinná)</label>
              <textarea id="uk-poznamka" name="poznamka" maxLength={1000} defaultValue={navrh?.poznamka ?? ''} />
            </div>

            <div className="pc-upozorneni-soukromi">
              Název a poznámku uvidí všichni, kdo úkoly vidí — <strong>ne jen účastníci rozhovoru</strong>.
              Zkontrolujte, že v nich není nic, co patří jen do rozhovoru.
            </div>

            <div>
              <div className="pc-dvojice">
                <div>
                  <label htmlFor="uk-den">Termín — den</label>
                  <input
                    id="uk-den"
                    type="date"
                    name="termin_datum"
                    defaultValue={naTerminu?.datum ?? ''}
                    data-kontrola={kontrolaTerminu ? '1' : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="uk-cas">Čas (nepovinný)</label>
                  <input
                    id="uk-cas"
                    type="time"
                    name="termin_cas"
                    defaultValue={naTerminu?.cas ?? ''}
                    data-kontrola={kontrolaTerminu ? '1' : undefined}
                  />
                </div>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: kontrolaTerminu ? 'var(--pozor)' : 'var(--muted)' }}>
                {kontrolaTerminu
                  ? 'Termín je k ověření — ze zprávy nebyl jednoznačný.'
                  : 'Bez času platí úkol do konce zvoleného dne.'}
              </p>
            </div>

            <fieldset>
              <legend>Komu</legend>
              <label className="pc-volba">
                <input type="radio" name="komu" value="pobocka" defaultChecked /> Nikomu konkrétnímu (celá pobočka)
              </label>
              <label className="pc-volba">
                <input type="radio" name="komu" value="clovek" /> Člověku
              </label>
              <select name="clovek" aria-label="Člověk" defaultValue="">
                <option value="">— vyberte —</option>
                {lide.map((c) => (
                  <option key={c.employee_id} value={c.employee_id}>
                    {c.jmeno}
                  </option>
                ))}
              </select>
              <label className="pc-volba" style={{ marginTop: '8px' }}>
                <input type="radio" name="komu" value="usek" /> Úseku
              </label>
              <select name="usek" aria-label="Úsek" defaultValue="">
                <option value="">— vyberte —</option>
                {(usekyData ?? []).map((u) => (
                  <option key={u.id as string} value={u.id as string}>
                    {String(u.nazev)}
                  </option>
                ))}
              </select>
              <label className="pc-volba" style={{ marginTop: '8px' }}>
                <input type="radio" name="komu" value="pozice" /> Zařazení
              </label>
              <select name="pozice" aria-label="Zařazení" defaultValue="">
                <option value="">— vyberte —</option>
                {(poziceData ?? []).map((p) => (
                  <option key={p.id as string} value={p.id as string}>
                    {String(p.label)}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>Důležitost</legend>
              <label className="pc-volba">
                <input type="radio" name="priorita" value="normal" defaultChecked={navrh?.priorita !== 'high'} /> Běžná
              </label>
              <label className="pc-volba">
                <input type="radio" name="priorita" value="high" defaultChecked={navrh?.priorita === 'high'} /> Důležitá
              </label>
            </fieldset>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Vytvořit úkol
              </button>
              <Link href={zpet} className="ft-tl ft-tl-vedlejsi">
                Zrušit
              </Link>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}
