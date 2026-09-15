import Link from 'next/link'
import { redirect } from 'next/navigation'

import { datumACasVPasmu, denVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KANALY } from '@/lib/marketing'
import { PILIRE } from '@/lib/marketing-kalendar'
import { popisStavu, popisStavuUlohy } from '@/lib/marketing-text'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Marketing — rozcestník.
 *
 * Zadání: master prompt, obrazovka 3 z oddílu 22 — „Dashboard má
 * nabídnout velké tlačítko ‚Vytvořit nový příspěvek nebo Reel',
 * blížící se akce, čekající schválení, dnešní naplánovaný obsah,
 * chyby připojení a stručný výkon posledních příspěvků."
 *
 * ---------------------------------------------------------------------
 * BYL TO SEZNAM PŘÍSPĚVKŮ, NE ROZCESTNÍK
 *
 * Do 14. 9. 2026 tu stálo dvacet posledních příspěvků a tři čísla
 * spočítaná z nich. Vypadalo to jako přehled a nebylo: kdo si otevřel
 * marketing ráno, nedozvěděl se, co dneska půjde ven ani že čtyři dny
 * nefunguje připojení.
 *
 * ---------------------------------------------------------------------
 * ČÍSLA SE POČÍTAJÍ V DATABÁZI, NE Z PRVNÍCH DVACETI ŘÁDKŮ
 *
 * TOHLE BYLA SKUTEČNÁ CHYBA, ne jen ošklivost. Původní obrazovka
 * načetla dvacet posledních příspěvků a z nich spočítala „ke schválení:
 * 3". Při dvaceti pěti příspěvcích se ta trojka stala nepravdou —
 * a nepoznalo by se to, protože číslo tam pořád nějaké stálo.
 *
 * Teď se počítá `head: true, count: 'exact'`, tedy nad celou tabulkou.
 *
 * ---------------------------------------------------------------------
 * TENANT_ID V KAŽDÉM DOTAZU
 *
 * Druhá skutečná chyba: dotazy se ptaly bez `tenant_id` a spoléhaly se
 * jen na RLS. To je jedna obranná linie místo dvou (CLAUDE.md,
 * pravidlo 3). RLS drží — ověřeno scénáři —, ale pravidlo neříká
 * „když jedna z nich funguje, druhá je zbytečná".
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

type Prispevek = {
  id: string
  nazev: string
  stav: string
  pilir: string
  planovano_na: string | null
  branch_id: string
}

type Uloha = {
  id: string
  prispevek_id: string
  kanal: string
  stav: string
  zverejneno_kdy: string | null
  planovano_na: string
  marketing_prispevky: { nazev: string; branch_id: string }[]
}

export default async function Marketing({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

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
        Modul si firma zapíná zvlášť. Pokud ho chcete používat, řekněte
        si o něj správci firmy — a pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  /*
    Migrace se nasazují zvlášť od aplikace. Dokud neproběhnou, tabulky
    tu nejsou — a obrazovka to má říct, ne spadnout na hlášce, ze které
    to nikdo nepozná.
  */
  const zkouska = await supabase
    .from('marketing_prispevky')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)

  if (tabulkaNeexistuje(zkouska.error)) {
    return (
      <>
        <Nadpis oci="Marketing" popis="Dílna na příspěvky ze schváleného jídelníčku.">
          Marketing
        </Nadpis>
        <div style={{ padding: '16px', paddingBottom: '32px' }}>
          <Sdeleni nadpis="Čeká se na nasazení databáze">
            Modul je v aplikaci, ale jeho tabulky zatím nejsou nasazené.
            Až proběhnou migrace, obrazovka se rozjede sama.
          </Sdeleni>
        </div>
      </>
    )
  }

  const smiPsat = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'

  /* --- PÁSMA -------------------------------------------------------- */

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )

  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (branchId: string | undefined) =>
    (branchId ? zonaPobocky.get(branchId) : null) ?? zonaFirmy

  // Dnešek v pásmu firmy, ne serveru — ten je na Vercelu v UTC
  // a po 22:00 by ukazoval zítřek (pravidlo 11).
  const dnes = denVPasmu(new Date(), zonaFirmy)

  /* --- ČÍSLA -------------------------------------------------------- */

  /*
    `head: true, count: 'exact'` znamená „spočítej, neposílej řádky".
    Počítá se nad CELOU tabulkou, ne nad prvními dvaceti — viz hlavička.

    Tři dotazy vypsané zvlášť, ne jedna chytrá pomocná funkce. Zkusil
    jsem ji a překladač ji neunesl (typy Supabase se u předávaného
    dotazu zacyklí). Tři řádky navíc jsou levnější než `any`, kterým
    by se to muselo umlčet — a `any` by tady schovalo právě to, co má
    typ hlídat: že se nezapomene `tenant_id`.
  */
  const kolik = (r: { count: number | null; error: unknown }) => (r.error ? 0 : r.count ?? 0)

  const keSchvaleni = kolik(await supabase.from('marketing_schvaleni')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('stav', 'ceka'))

  const rozdelane = kolik(await supabase.from('marketing_prispevky')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('stav', ['koncept', 'navrh_hotovy']))

  const nepovedlo = kolik(await supabase.from('marketing_publikace_ulohy')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('stav', ['selhalo', 'vzdano']))

  /* --- CO DNESKA PŮJDE VEN ------------------------------------------ */

  /*
    Meze se berou o den širší na každou stranu a přesný den se pozná až
    přes `denVPasmu` — pásmo pobočky zná pravidla letního času, kdežto
    hranice spočítaná v UTC ne. Je to totéž, co dělá kalendář
    (`lib/marketing-kalendar.ts`, `mezeObdobi`).
  */
  const naplanovane = await seznam<Prispevek>(
    'naplánované příspěvky',
    supabase.from('marketing_prispevky')
      .select('id, nazev, stav, pilir, planovano_na, branch_id')
      .eq('tenant_id', tenantId)
      .not('planovano_na', 'is', null)
      .gte('planovano_na', `${dnes}T00:00:00Z`)
      .not('stav', 'in', '(archivovano,zamitnuto)')
      .order('planovano_na')
      .limit(20),
  )

  const dnesni = naplanovane.filter(
    (p) => p.planovano_na && denVPasmu(p.planovano_na, zona(p.branch_id)) === dnes,
  )
  const dalsi = naplanovane.filter(
    (p) => p.planovano_na && denVPasmu(p.planovano_na, zona(p.branch_id)) > dnes,
  ).slice(0, 5)

  /* --- BLÍŽÍCÍ SE AKCE ---------------------------------------------- */

  const kampane = await seznam<{
    id: string; nazev: string; kona_se_kdy: string | null; branch_id: string; pilir: string
  }>(
    'blížící se akce',
    supabase.from('marketing_kampane')
      .select('id, nazev, kona_se_kdy, branch_id, pilir')
      .eq('tenant_id', tenantId)
      .not('kona_se_kdy', 'is', null)
      .gte('kona_se_kdy', new Date().toISOString())
      .in('stav', ['pripravuje_se', 'bezi'])
      .order('kona_se_kdy')
      .limit(4),
  ).catch(() => [])

  /* --- CHYBY PŘIPOJENÍ ---------------------------------------------- */

  /*
    Zadání to chce na rozcestníku schválně: nefunkční připojení se
    jinak pozná až tím, že příspěvek neodešel — tedy pozdě. Tady je to
    vidět dřív, než se něco naplánuje.
  */
  const spatnaPripojeni = await seznam<{
    id: string; poskytovatel: string; kategorie: string; stav: string; posledni_chyba: string | null
  }>(
    'připojení, která zlobí',
    supabase.from('marketing_pripojeni')
      .select('id, poskytovatel, kategorie, stav, posledni_chyba')
      .eq('tenant_id', tenantId)
      .is('odpojeno_kdy', null)
      .in('stav', ['chyba', 'vyzaduje_pozornost'])
      .limit(5),
  ).catch(() => [])

  /* --- POSLEDNÍ ZVEŘEJNĚNÉ ------------------------------------------ */

  const posledni = await seznam<Uloha>(
    'poslední zveřejněné',
    supabase.from('marketing_publikace_ulohy')
      .select('id, prispevek_id, kanal, stav, zverejneno_kdy, planovano_na, marketing_prispevky ( nazev, branch_id )')
      .eq('tenant_id', tenantId)
      .in('stav', ['zverejneno', 'zverejneno_nanecisto'])
      .order('zverejneno_kdy', { ascending: false, nullsFirst: false })
      .limit(5),
  ).catch(() => [])

  /* --- VÝKON, KTERÝ UMÍME ZMĚŘIT SAMI -------------------------------- */

  /*
    Jen prokliky přes náš krátký odkaz. Zobrazení a dosah dává síť
    a ta připojená není — a neměřené číslo se neukazuje jako nula.

    `.catch` schválně: když migrace s odkazy ještě neproběhla, nemá
    kvůli tomu spadnout celý rozcestník. Rozcestník je to první, co
    člověk po ránu otevře.
  */
  const odkazy = await seznam<{ prokliku: number }>(
    'prokliky',
    supabase.from('marketing_odkazy').select('prokliku').eq('tenant_id', tenantId),
  ).catch(() => [])
  const prokliky = odkazy.reduce((s, o) => s + (o.prokliku ?? 0), 0)

  /* --- ZNAČKA ------------------------------------------------------- */

  const znacka = await supabase
    .from('marketing_nastaveni')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)
  const maZnacku = !znacka.error && (znacka.data?.length ?? 0) > 0

  const barvaPiliru = (p: string) => PILIRE.find((x) => x.klic === p)?.barva ?? 'var(--line)'

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis="Nic se nezveřejní bez schválení přesné verze."
      >
        Marketing
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>

        {/* --- VELKÉ TLAČÍTKO --------------------------------------- */}

        {smiPsat ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link
              href={`/${rozsah}/marketing/tvorba`}
              className="ft-tl ft-tl-hlavni"
              style={{ fontSize: '16px', padding: '12px 20px' }}
            >
              Vytvořit příspěvek
            </Link>
            <Link href={`/${rozsah}/marketing/kalendar`} className="ft-tl">Kalendář</Link>
            <Link href={`/${rozsah}/marketing/media`} className="ft-tl">Fotky</Link>
            <Link href={`/${rozsah}/marketing/menu`} className="ft-tl">Menu</Link>
          </div>
        ) : null}

        {/* --- CO ZLOBÍ --------------------------------------------- */}

        {spatnaPripojeni.length > 0 ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>Připojení zlobí</strong>
            <ul style={{ margin: '8px 0 12px', padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
              {spatnaPripojeni.map((p) => (
                <li key={p.id} style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  <strong>{p.poskytovatel}</strong> ({p.kategorie})
                  {p.posledni_chyba ? ` — ${p.posledni_chyba}` : ''}
                </li>
              ))}
            </ul>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
              Dokud to nespravíte, příspěvky se buď neodešlou, nebo skončí k ručnímu zveřejnění.
            </p>
            <Link href={`/${rozsah}/marketing/nastroje`} className="ft-tl ft-tl-hlavni ft-tl-male">
              Otevřít Nástroje
            </Link>
          </div>
        ) : null}

        {!maZnacku ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>Nejdřív značka</strong>
            <p style={{ margin: '8px 0 12px', fontSize: '14px', color: 'var(--muted)' }}>
              Barvy, písmo, podpis a tón hlasu. Bez nich by se návrhy
              musely domýšlet — a to se u marketingu dělat nemá.
            </p>
            <Link href={`/${rozsah}/marketing/znacka`} className="ft-tl ft-tl-hlavni ft-tl-male">
              Nastavit značku
            </Link>
          </div>
        ) : null}

        {/* --- ČÍSLA ------------------------------------------------ */}

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Cislo
            nazev="Čeká na odklepnutí"
            hodnota={keSchvaleni}
            kam={`/${rozsah}/marketing/schvalovani`}
            zvyraznit={keSchvaleni > 0}
          />
          <Cislo nazev="Rozpracované" hodnota={rozdelane} kam={`/${rozsah}/marketing/kalendar`} />
          <Cislo
            nazev="Nepovedlo se"
            hodnota={nepovedlo}
            kam={`/${rozsah}/marketing/publikovane`}
            zvyraznit={nepovedlo > 0}
          />
        </div>

        {/* --- DNESKA ----------------------------------------------- */}

        <section style={{ ...karta, display: 'grid', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Dnes</h2>
          {dnesni.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Na dnešek není naplánované nic.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {dnesni.map((p) => (
                <li key={p.id} style={{ fontSize: '14px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                    background: barvaPiliru(p.pilir), marginRight: '6px',
                  }} />
                  <Link href={`/${rozsah}/marketing/${p.id}`}>{p.nazev}</Link>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {' · '}{p.planovano_na ? datumACasVPasmu(p.planovano_na, zona(p.branch_id)) : ''}
                    {' · '}{popisStavu(p.stav)}
                    {pobocky.length > 1 ? ` · ${nazevPobocky.get(p.branch_id) ?? ''}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {dalsi.length > 0 ? (
            <>
              <h3 style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>Dál v plánu</h3>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '4px' }}>
                {dalsi.map((p) => (
                  <li key={p.id} style={{ fontSize: '13px' }}>
                    <Link href={`/${rozsah}/marketing/${p.id}`}>{p.nazev}</Link>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {' · '}{p.planovano_na ? datumACasVPasmu(p.planovano_na, zona(p.branch_id)) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* --- BLÍŽÍCÍ SE AKCE -------------------------------------- */}

        {kampane.length > 0 ? (
          <section style={{ ...karta, display: 'grid', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '16px' }}>Blížící se akce</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {kampane.map((k) => (
                <li key={k.id} style={{ fontSize: '14px' }}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                    background: barvaPiliru(k.pilir), marginRight: '6px',
                  }} />
                  <Link href={`/${rozsah}/marketing/kampane`}>{k.nazev}</Link>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {' · '}{k.kona_se_kdy ? datumACasVPasmu(k.kona_se_kdy, zona(k.branch_id)) : ''}
                    {pobocky.length > 1 ? ` · ${nazevPobocky.get(k.branch_id) ?? ''}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* --- POSLEDNÍ ZVEŘEJNĚNÉ ---------------------------------- */}

        <section style={{ ...karta, display: 'grid', gap: '8px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Naposledy odesláno</h2>

          {posledni.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím nic neodešlo.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {posledni.map((u) => {
                const p = u.marketing_prispevky[0]
                const nanecisto = u.stav === 'zverejneno_nanecisto'
                return (
                  <li key={u.id} style={{ fontSize: '14px' }}>
                    <Link href={`/${rozsah}/marketing/${u.prispevek_id}`}>{p?.nazev ?? 'Příspěvek'}</Link>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {' · '}{KANALY.find((k) => k.klic === u.kanal)?.nazev ?? u.kanal}
                      {' · '}{datumACasVPasmu(u.zverejneno_kdy ?? u.planovano_na, zona(p?.branch_id))}
                    </span>
                    {nanecisto ? (
                      <span style={{
                        marginLeft: '6px', fontSize: '11px', padding: '1px 5px',
                        borderRadius: '4px', border: '1px solid var(--mosaz)', color: 'var(--mosaz)',
                      }}>
                        NANEČISTO
                      </span>
                    ) : null}
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {' · '}{popisStavuUlohy(u.stav)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {/*
            ZADÁNÍ TU CHCE „STRUČNÝ VÝKON POSLEDNÍCH PŘÍSPĚVKŮ" (oddíl 22).

            Ukazuje se JEN TO, CO UMÍME ZMĚŘIT SAMI — prokliky přes náš
            krátký odkaz. Zobrazení a dosah dává síť a ta dnes připojená
            není, takže se o nich mlčí.

            Nuly by tu byly horší než mezera: nula zobrazení vypadá jako
            propadák, ne jako „neměřeno" (zadání, oddíl 18: co se nedá
            prokázat, se nemá tvářit jako přesné číslo).
          */}
          {prokliky > 0 ? (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              Měřitelné odkazy zatím dostaly <strong>{prokliky}</strong>{' '}
              {prokliky === 1 ? 'proklik' : prokliky < 5 ? 'prokliky' : 'prokliků'}.{' '}
              <Link href={`/${rozsah}/marketing/analytika`}>Analytika</Link>
              {' · '}
              <Link href={`/${rozsah}/marketing/audit`}>Kdo co změnil</Link>
            </p>
          ) : (
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              Kolik to mělo zobrazení, se zatím neměří — čísla dává síť a ta
              připojená není. Co změřit jde, jsou prokliky přes{' '}
              <Link href={`/${rozsah}/marketing/analytika`}>měřitelný odkaz</Link>.
              {' · '}
              <Link href={`/${rozsah}/marketing/audit`}>Kdo co změnil</Link>
            </p>
          )}
        </section>
      </div>
    </>
  )
}

/** Jedno číslo na rozcestníku. Prokliknutelné — číslo bez cesty je k ničemu. */
function Cislo({
  nazev,
  hodnota,
  kam,
  zvyraznit,
}: {
  nazev: string
  hodnota: number
  kam: string
  zvyraznit?: boolean
}) {
  return (
    <Link
      href={kam}
      style={{
        ...karta,
        borderColor: zvyraznit ? 'var(--mosaz)' : 'var(--line)',
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)' }}>{nazev}</span>
      <span style={{
        display: 'block', marginTop: '4px', fontSize: '26px',
        color: zvyraznit ? 'var(--mosaz)' : 'inherit',
      }}>
        {hodnota}
      </span>
    </Link>
  )
}
