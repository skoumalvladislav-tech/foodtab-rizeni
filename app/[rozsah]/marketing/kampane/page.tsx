import Link from 'next/link'
import { redirect } from 'next/navigation'

import { datumACasVPasmu, denVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KANALY } from '@/lib/marketing'
import { PILIRE, popisPilire } from '@/lib/marketing-kalendar'
import { DNY_ZKRATKY_ISO, DRUHY_AUTOMATIZACE, popisDnu } from '@/lib/marketing-kampane'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { prepnoutAutomatizaci, vyrobitSerii, zalozitAutomatizaci, zalozitKampan } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Kampaně a automatizace.
 *
 * Zadání: master prompt, oddíl 15 a obrazovka 11 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NESTAČILO ŘEŠIT KALENDÁŘEM
 *
 * Kalendář ukazuje, co kdy půjde ven. Obsah se ale pořád zakládal po
 * jednom příspěvku — a restaurace nedělá jeden příspěvek. Dělá AKCI
 * a k ní patří série: pozvánka týden předem, připomínka den předem,
 * poslední výzva ráno, po akci poděkování.
 *
 * ---------------------------------------------------------------------
 * AUTOMATIZACE NIC NEZVEŘEJNÍ
 *
 * Vyrobí koncepty a ty projdou schválením jako všechno ostatní. Je to
 * napsané i na obrazovce, ne jen v kódu — kdo něco zapíná, má vědět,
 * co se stane. Kdyby uměla naplánovat publikaci, stačilo by jednou
 * špatně nastavit opakování a restaurace by měsíc zveřejňovala
 * nesmysly.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
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

type Kampan = {
  id: string
  nazev: string
  cil: string
  kona_se_kdy: string | null
  pilir: string
  stav: string
  branch_id: string
  marketing_prispevky: { id: string }[]
}

type Automatizace = {
  id: string
  nazev: string
  druh: string
  cas_spusteni: string
  dny_v_tydnu: number[] | null
  predstih_dnu: number
  zapnuta: boolean
  branch_id: string
  posledni_beh_kdy: string | null
  pristi_beh_kdy: string | null
  marketing_automatizace_behy: {
    bezelo_kdy: string; vysledek: string; zalozeno_konceptu: number; duvod: string
  }[]
}

function popisStavuKampane(stav: string): string {
  return stav === 'bezi' ? 'běží'
    : stav === 'hotova' ? 'hotová'
      : stav === 'zrusena' ? 'zrušená'
        : 'připravuje se'
}

export default async function Kampane({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{
    chyba?: string; zalozeno?: string; serie?: string; automat?: string
    zapnuto?: string; vypnuto?: string
  }>
}) {
  const { rozsah } = await params
  const q = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Kampaně vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  const smiPripravovat = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  // Zapnout něco, co bude samo vyrábět obsah, je rozhodnutí toho druhu
  // jako poslat příspěvek ven — proto totéž právo.
  const smiZapinat = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'

  const supabase = await getServerSupabase()

  const dotazKampani = await supabase.from('marketing_kampane')
    .select('id, nazev, cil, kona_se_kdy, pilir, stav, branch_id, marketing_prispevky ( id )')
    .eq('tenant_id', tenantId)
    .order('kona_se_kdy', { ascending: false, nullsFirst: false })
    .limit(50)

  if (tabulkaNeexistuje(dotazKampani.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Kampaně</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Kampaně zatím nejsou v databázi">
            Migrace <code>20260914140000_marketing_kampane.sql</code> ještě neproběhla.
            Nasazuje je Šéfík z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const kampane = await seznam<Kampan>('kampaně', Promise.resolve(dotazKampani))

  const automatizace = await seznam<Automatizace>(
    'automatizace',
    supabase.from('marketing_automatizace')
      .select(`
        id, nazev, druh, cas_spusteni, dny_v_tydnu, predstih_dnu, zapnuta,
        branch_id, posledni_beh_kdy, pristi_beh_kdy,
        marketing_automatizace_behy ( bezelo_kdy, vysledek, zalozeno_konceptu, duvod )
      `)
      .eq('tenant_id', tenantId)
      .order('nazev'),
  )

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId).order('name'),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )

  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (branchId: string) => zonaPobocky.get(branchId) ?? zonaFirmy

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={`${kampane.length} kampaní · ${automatizace.filter((a) => a.zapnuta).length} zapnutých automatizací`}
      >
        Kampaně
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>
        {q.chyba ? <p className="hlaska-chyba">{q.chyba}</p> : null}
        {q.serie ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Založeno {q.serie} konceptů. <strong>Nic se nezveřejnilo</strong> — projděte je,
            doplňte text a pošlete ke schválení.
          </p>
        ) : null}
        {q.zalozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Kampaň založena.</p> : null}
        {q.automat ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Automatizace založena — a je <strong>vypnutá</strong>. Zapněte ji, až si ji projdete.
          </p>
        ) : null}
        {q.zapnuto ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Zapnuto.</p> : null}
        {q.vypnuto ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Vypnuto. Historie zůstala.</p> : null}

        {/* --- NOVÁ KAMPAŇ ------------------------------------------ */}

        {smiPripravovat ? (
          <form action={zalozitKampan} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Nová kampaň</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Jedna akce a všechno, co se k ní zveřejní. Když doplníte termín,
                dá se z ní vyrobit celá série — pozvánka, připomínka, poslední výzva
                a poděkování po akci.
              </p>
            </div>

            <label>
              <span style={popisek}>Název</span>
              <input name="nazev" style={pole} placeholder="Zabijačka" required />
            </label>

            <label>
              <span style={popisek}>Čeho chcete dosáhnout</span>
              <input name="cil" style={pole} placeholder="Naplnit sobotní oběd" />
            </label>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 180px' }}>
                <span style={popisek}>Provozovna</span>
                <select name="pobocka" style={pole} defaultValue={pobocky[0]?.id ?? ''}>
                  {pobocky.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ flex: '1 1 140px' }}>
                <span style={popisek}>Kdy se to koná</span>
                <input type="date" name="datum" style={pole} />
              </label>
              <label style={{ flex: '0 0 110px' }}>
                <span style={popisek}>V kolik</span>
                <input type="time" name="cas" defaultValue="18:00" style={pole} />
              </label>
              <label style={{ flex: '1 1 140px' }}>
                <span style={popisek}>Pilíř</span>
                <select name="pilir" style={pole} defaultValue="akce">
                  {PILIRE.map((p) => <option key={p.klic} value={p.klic}>{p.nazev}</option>)}
                </select>
              </label>
            </div>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Založit kampaň</button>
            </div>
          </form>
        ) : null}

        {/* --- KAMPANĚ ---------------------------------------------- */}

        <section style={{ ...karta, display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Kampaně</h2>

          {kampane.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádná kampaň. {smiPripravovat ? 'Založte ji výš.' : null}
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '12px' }}>
              {kampane.map((k) => {
                const pocet = k.marketing_prispevky?.length ?? 0

                return (
                  <li key={k.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <div style={{ fontSize: '14.5px' }}>
                      <span style={{
                        display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                        background: PILIRE.find((p) => p.klic === k.pilir)?.barva ?? 'var(--line)',
                        marginRight: '6px',
                      }} />
                      {k.nazev}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                      {popisStavuKampane(k.stav)}
                      {' · '}{nazevPobocky.get(k.branch_id) ?? 'Provozovna'}
                      {' · '}{popisPilire(k.pilir)}
                      {k.kona_se_kdy ? ` · ${datumACasVPasmu(k.kona_se_kdy, zona(k.branch_id))}` : ' · bez termínu'}
                      {' · '}{pocet === 0 ? 'zatím bez příspěvků' : pocet === 1 ? '1 příspěvek' : `${pocet} příspěvků`}
                    </div>
                    {k.cil ? (
                      <div style={{ fontSize: '13px', marginTop: '4px' }}>{k.cil}</div>
                    ) : null}

                    {smiPripravovat && pocet === 0 ? (
                      k.kona_se_kdy ? (
                        <form action={vyrobitSerii} style={{ marginTop: '8px' }}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="kampan" value={k.id} />
                          <button type="submit" className="ft-tl ft-tl-male">Vyrobit sérii</button>
                          <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}>
                            Čtyři koncepty s návrhem termínu. Nic se nezveřejní.
                          </span>
                        </form>
                      ) : (
                        <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                          Sérii jde vyrobit jen ke kampani s termínem akce.
                        </p>
                      )
                    ) : null}

                    {pocet > 0 ? (
                      <p style={{ margin: '6px 0 0', fontSize: '12px' }}>
                        <Link href={`/${rozsah}/marketing/kalendar`}>Zobrazit v kalendáři</Link>
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* --- AUTOMATIZACE ----------------------------------------- */}

        <section style={{ ...karta, display: 'grid', gap: '10px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Automatizace</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              {/*
                Tahle věta je na obrazovce schválně. Kdo něco zapíná, má
                vědět, co se stane — a to nejdůležitější je, že se nic
                nezveřejní samo.
              */}
              <strong>Nic nezveřejňují.</strong> Připraví koncepty, které projdou
              schválením jako všechno ostatní. Každou jde kdykoli vypnout;
              historie zůstane.
            </p>
          </div>

          {automatizace.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádná automatizace.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '12px' }}>
              {automatizace.map((a) => {
                const behy = [...(a.marketing_automatizace_behy ?? [])]
                  .sort((x, y) => y.bezelo_kdy.localeCompare(x.bezelo_kdy))
                  .slice(0, 3)
                const druh = DRUHY_AUTOMATIZACE.find((d) => d.klic === a.druh)

                return (
                  <li key={a.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '14.5px' }}>{a.nazev}</span>
                      <span style={{
                        fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                        border: `1px solid ${a.zapnuta ? 'var(--mosaz)' : 'var(--line)'}`,
                        color: a.zapnuta ? 'var(--mosaz)' : 'var(--muted)',
                      }}>
                        {a.zapnuta ? 'ZAPNUTO' : 'VYPNUTO'}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                      {druh?.nazev ?? a.druh}
                      {' · '}{nazevPobocky.get(a.branch_id) ?? 'Provozovna'}
                      {' · '}{popisDnu(a.dny_v_tydnu ?? [])} v {a.cas_spusteni.slice(0, 5)}
                      {a.predstih_dnu > 0 ? ` · ${a.predstih_dnu} dnů předem` : ''}
                    </div>

                    {/*
                      POSLEDNÍ A PŘÍŠTÍ SPUŠTĚNÍ. Zadání, oddíl 15.
                      Automatizace, u které není vidět, kdy naposledy
                      běžela, je horší než ruční práce — ruční práci je
                      aspoň vidět.
                    */}
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                      {a.posledni_beh_kdy
                        ? `Naposledy ${datumACasVPasmu(a.posledni_beh_kdy, zona(a.branch_id))}`
                        : 'Zatím neběžela'}
                      {a.zapnuta && a.pristi_beh_kdy
                        ? ` · příště ${datumACasVPasmu(a.pristi_beh_kdy, zona(a.branch_id))}`
                        : a.zapnuta ? ' · příští běh se nepodařilo spočítat' : ''}
                    </div>

                    {behy.length > 0 ? (
                      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', fontSize: '12px', color: 'var(--muted)' }}>
                        {behy.map((b, i) => (
                          <li key={i}>
                            {denVPasmu(b.bezelo_kdy, zona(a.branch_id))}
                            {' — '}
                            {b.vysledek === 'hotovo' ? `${b.zalozeno_konceptu} konceptů`
                              : b.vysledek === 'preskoceno' ? 'přeskočeno'
                                : 'chyba'}
                            {b.duvod ? `: ${b.duvod}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {smiZapinat ? (
                      <form action={prepnoutAutomatizaci} style={{ marginTop: '8px' }}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="automatizace" value={a.id} />
                        <input type="hidden" name="zapnout" value={a.zapnuta ? '0' : '1'} />
                        <button type="submit" className="ft-tl ft-tl-male">
                          {a.zapnuta ? 'Pozastavit' : 'Zapnout'}
                        </button>
                      </form>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* --- NOVÁ AUTOMATIZACE ------------------------------------ */}

        {smiZapinat ? (
          <form action={zalozitAutomatizaci} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Nová automatizace</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Zakládá se <strong>vypnutá</strong> — napoprvé se nastavuje naslepo
                a první běh by přišel dřív, než si to stihnete přečíst.
              </p>
            </div>

            <label>
              <span style={popisek}>Název</span>
              <input name="nazev" style={pole} placeholder="Denní menu ráno" required />
            </label>

            <label>
              <span style={popisek}>Co má dělat</span>
              <select name="druh" style={pole} defaultValue="denni_menu">
                {DRUHY_AUTOMATIZACE.map((d) => (
                  <option key={d.klic} value={d.klic}>{d.nazev}</option>
                ))}
              </select>
            </label>

            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12px', color: 'var(--muted)', display: 'grid', gap: '2px' }}>
              {DRUHY_AUTOMATIZACE.map((d) => (
                <li key={d.klic}><strong>{d.nazev}:</strong> {d.popis}</li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ flex: '0 0 110px' }}>
                <span style={popisek}>V kolik</span>
                <input type="time" name="cas" defaultValue="08:00" style={pole} />
              </label>
              <label style={{ flex: '0 0 140px' }}>
                <span style={popisek}>Předstih (dny)</span>
                <input type="number" name="predstih" defaultValue={0} min={0} max={30} style={pole} />
              </label>
            </div>

            <div>
              <span style={popisek}>Ve které dny</span>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {DNY_ZKRATKY_ISO.map((zkratka, i) => (
                  <label key={zkratka} style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '13px' }}>
                    <input type="checkbox" name="den" value={i + 1} />
                    {zkratka}
                  </label>
                ))}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                Nezaškrtnete-li nic, poběží každý den.
              </p>
            </div>

            <div>
              <span style={popisek}>Na které sítě</span>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {KANALY.map((k) => (
                  <label key={k.klic} style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '13px' }}>
                    <input type="checkbox" name="kanal" value={k.klic} defaultChecked />
                    {k.nazev}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <button type="submit" className="ft-tl">Založit (vypnutou)</button>
            </div>
          </form>
        ) : null}
      </div>
    </>
  )
}
