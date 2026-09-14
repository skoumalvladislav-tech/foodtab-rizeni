import Link from 'next/link'
import { redirect } from 'next/navigation'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KANALY } from '@/lib/marketing'
import {
  UKAZATELE,
  adresaOdkazu,
  hodnotaNaObrazovku,
  popisUkazatele,
  popisZdroje,
} from '@/lib/marketing-odkazy'
import { qrSvg } from '@/lib/qr'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { vypnoutOdkaz, zalozitOdkaz } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Analytika — co se dá změřit a co ne.
 *
 * Zadání: master prompt, oddíl 18 a obrazovka 13 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * TAHLE OBRAZOVKA UKAZUJE VÍC PRÁZDNA NEŽ ČÍSEL, A JE TO SPRÁVNĚ
 *
 * Zobrazení a dosah dává síť. Foodtab je dnes nemá — účty se
 * z Mety nenačítají a stahování metrik neexistuje. Jediné, co umíme
 * změřit sami, jsou PROKLIKY přes náš krátký odkaz.
 *
 * Ukázat místo chybějících čísel nuly by bylo horší než neukázat nic:
 * nula zobrazení vypadá jako propadák, ne jako „neměřeno“. Zadání to
 * říká výslovně — „zobraz pouze metriky, které daná síť a oprávnění
 * skutečně poskytují".
 *
 * ---------------------------------------------------------------------
 * QR JE TU PROTO, ŽE RESTAURACE MÁ PAPÍR
 *
 * Odkaz z Instagramu se dá kliknout. Na stojánku na stole, na plakátu
 * ve výloze a na účtence se kliknout nedá — a přesně tam vede většina
 * cesty od hosta k rezervaci. QR se proto kreslí rovnou tady, aby se
 * dalo vytisknout.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type Odkaz = {
  id: string
  klic: string
  cil: string
  popis: string
  utm_source: string
  utm_campaign: string
  prokliku: number
  posledni_klik: string | null
  aktivni: boolean
  branch_id: string
}

type Metrika = {
  ukazatel: string
  hodnota: number | null
  zdroj: string
  den: string
}

export default async function Analytika({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; zalozeno?: string; vypnuto?: string; zapnuto?: string }>
}) {
  const { rozsah } = await params
  const q = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Analytiku vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  const dotaz = await supabase.from('marketing_odkazy')
    .select('id, klic, cil, popis, utm_source, utm_campaign, prokliku, posledni_klik, aktivni, branch_id')
    .eq('tenant_id', tenantId)
    .order('vytvoreno_kdy', { ascending: false })
    .limit(50)

  if (tabulkaNeexistuje(dotaz.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Analytika</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Měření zatím není v databázi">
            Migrace <code>20260914180000_marketing_metriky.sql</code> ještě neproběhla.
            Nasazuje je Šéfík z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const odkazy = await seznam<Odkaz>('měřitelné odkazy', Promise.resolve(dotaz))

  const metriky = await seznam<Metrika>(
    'metriky',
    supabase.from('marketing_metriky')
      .select('ukazatel, hodnota, zdroj, den')
      .eq('tenant_id', tenantId)
      .order('den', { ascending: false })
      .limit(200),
  ).catch(() => [])

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )
  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (b: string | undefined) => (b ? zonaPobocky.get(b) : null) ?? zonaFirmy

  /*
    SOUČET PODLE UKAZATELE. Chybí-li ukazatel úplně, NEUKÁŽE SE jako
    nula — vrací se `null` a obrazovka nakreslí pomlčku.
  */
  const soucet = (ukazatel: string): { hodnota: number | null; zdroj: string } => {
    const vybrane = metriky.filter((m) => m.ukazatel === ukazatel && m.hodnota !== null)
    if (vybrane.length === 0) return { hodnota: null, zdroj: '' }
    return {
      hodnota: vybrane.reduce((s, m) => s + (m.hodnota ?? 0), 0),
      // Když je mezi čísly aspoň jeden odhad, je odhad celý součet.
      zdroj: vybrane.some((m) => m.zdroj === 'odhad') ? 'odhad' : vybrane[0].zdroj,
    }
  }

  const prokliky = odkazy.reduce((s, o) => s + o.prokliku, 0)
  const zadnaData = metriky.length === 0

  /*
    Adresa aplikace. Bez ní se nedá složit celý odkaz ani QR — a hádat
    ji z hlaviček požadavku by znamenalo, že na jiné doméně se QR
    vytiskne se špatnou adresou.
  */
  const zaklad = process.env.NEXT_PUBLIC_APP_URL ?? ''

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={`${odkazy.length} měřitelných odkazů · ${prokliky} prokliků`}
      >
        Analytika
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>
        {q.chyba ? <p className="hlaska-chyba">{q.chyba}</p> : null}
        {q.zalozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Odkaz založen.</p> : null}
        {q.vypnuto ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Odkaz vypnutý. Počet prokliků zůstal.</p> : null}
        {q.zapnuto ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Odkaz zase funguje.</p> : null}

        {/* --- CO SE MĚŘÍ A CO NE ----------------------------------- */}

        {zadnaData ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>Čísla ze sítí zatím nechodí</strong>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>
              Zobrazení, dosah a reakce dává Instagram a Facebook — a k tomu je
              potřeba připojený účet s oprávněním číst statistiky. Dokud ho
              nemáte, tahle část zůstane prázdná.
              {' '}
              <strong>Nuly tu schválně nejsou:</strong> nula zobrazení vypadá jako
              propadák, ne jako „neměřeno“.
            </p>
            <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              Co měřit umíme i bez sítí, jsou <strong>prokliky</strong> přes odkaz níž.
            </p>
          </div>
        ) : null}

        <section style={{ ...karta, display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Ze sítí</h2>
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {UKAZATELE.filter((u) => u.klic !== 'kliknuti').map((u) => {
              const s = soucet(u.klic)
              return (
                <div key={u.klic} style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '10px' }}>
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)' }}>
                    {popisUkazatele(u.klic)}
                  </span>
                  <span style={{ display: 'block', fontSize: '20px', marginTop: '2px' }}>
                    {hodnotaNaObrazovku(s.hodnota)}
                  </span>
                  {s.zdroj ? (
                    <span style={{
                      display: 'block', fontSize: '11px',
                      color: s.zdroj === 'odhad' ? 'var(--mosaz)' : 'var(--muted)',
                    }}>
                      {popisZdroje(s.zdroj)}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
            Pomlčka znamená <strong>neměřeno</strong>, ne nulu. U každého čísla je vidět,
            odkud je — a odhad se označuje.
          </p>
        </section>

        {/* --- MĚŘITELNÉ ODKAZY ------------------------------------- */}

        {smiMenit ? (
          <form action={zalozitOdkaz} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Nový měřitelný odkaz</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Krátká adresa, která vede přes nás na váš web. Počítá prokliky
                a přidá značky pro měření, takže se dá poznat, odkud host přišel.
                Ke každému je QR na plakát.
              </p>
            </div>

            <label>
              <span style={popisek}>Kam má vést</span>
              <input name="cil" style={pole} placeholder="https://cernaperla.cz/rezervace" required />
            </label>

            <label>
              <span style={popisek}>K čemu to je</span>
              <input name="popis" style={pole} placeholder="Rezervace na zabijačku" />
            </label>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 160px' }}>
                <span style={popisek}>Odkud povede</span>
                <select name="kanal" style={pole} defaultValue="instagram">
                  {KANALY.map((k) => <option key={k.klic} value={k.klic}>{k.nazev}</option>)}
                  <option value="qr">QR na papíře</option>
                </select>
              </label>
              <label style={{ flex: '1 1 200px' }}>
                <span style={popisek}>Ke které akci (nepovinné)</span>
                <input name="kampan" style={pole} placeholder="Zabijačka" />
              </label>
            </div>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Vyrobit odkaz</button>
            </div>
          </form>
        ) : null}

        <section style={{ ...karta, display: 'grid', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Měřitelné odkazy</h2>

          {odkazy.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádný. {smiMenit ? 'Vyrobte ho výš — je to jediné, co se dá měřit bez připojených sítí.' : null}
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '16px' }}>
              {odkazy.map((o) => {
                const adresa = zaklad ? adresaOdkazu(zaklad, o.klic) : `/k/${o.klic}`

                return (
                  <li key={o.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '12px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    {/*
                      QR se kreslí jen u zapnutého odkazu. Vytisknout QR,
                      který nikam nevede, je horší než ho nenabídnout.
                    */}
                    {o.aktivni && zaklad ? (
                      <div
                        style={{ flex: '0 0 auto', lineHeight: 0 }}
                        dangerouslySetInnerHTML={{ __html: qrSvg(adresa, { velikost: 96, popis: `QR na ${o.popis || adresa}` }) }}
                      />
                    ) : null}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '14.5px' }}>
                        {o.popis || 'Bez popisu'}
                        {!o.aktivni ? (
                          <span style={{
                            marginLeft: '8px', fontSize: '11px', padding: '1px 6px',
                            borderRadius: '4px', border: '1px solid var(--line)', color: 'var(--muted)',
                          }}>
                            VYPNUTO
                          </span>
                        ) : null}
                      </div>

                      <div style={{ fontSize: '13px', marginTop: '2px', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                        {adresa}
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                        → {o.cil}
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                        <strong style={{ color: 'var(--text)' }}>{hodnotaNaObrazovku(o.prokliku)}</strong>
                        {' prokliků'}
                        {o.posledni_klik
                          ? ` · naposledy ${datumACasVPasmu(o.posledni_klik, zona(o.branch_id))}`
                          : ' · zatím nikdo neklikl'}
                        {o.utm_campaign ? ` · akce ${o.utm_campaign}` : ''}
                      </div>

                      {smiMenit ? (
                        <form action={vypnoutOdkaz} style={{ marginTop: '8px' }}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="odkaz" value={o.id} />
                          <input type="hidden" name="zapnout" value={o.aktivni ? '0' : '1'} />
                          <button type="submit" className="ft-tl ft-tl-male">
                            {o.aktivni ? 'Vypnout' : 'Zapnout'}
                          </button>
                          <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}>
                            {o.aktivni
                              ? 'Vypnutý odkaz přestane fungovat hostům, ale počet prokliků zůstane.'
                              : 'Zapnutím začne zase fungovat.'}
                          </span>
                        </form>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {!zaklad ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--mosaz)' }}>
              Adresa aplikace není nastavená (<code>NEXT_PUBLIC_APP_URL</code>), takže se
              nedá složit celý odkaz ani QR. Doplňte ji v nastavení nasazení.
            </p>
          ) : null}
        </section>

        <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
          Propojení výkonu s rezervací nebo objednávkou přijde, až budou ve Foodtabu.
          Do té doby se neodhaduje — <Link href={`/${rozsah}/marketing/publikovane`}>co odešlo</Link>{' '}
          je vidět v Publikovaných.
        </p>
      </div>
    </>
  )
}
