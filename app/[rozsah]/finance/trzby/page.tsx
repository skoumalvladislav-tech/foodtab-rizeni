import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { ZONA_VYCHOZI } from '@/lib/cas'
import { provozniDen } from '@/lib/pokladna-cas'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { DotazSelhal, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import { nactiPrehledTrzeb } from '@/lib/pokladna-trzby-nacteni'
import { dalsiObdobi, jenPobocka, pokladnaPatriPobocce, popisObdobi, type Cleneni, type PrehledTrzeb } from '@/lib/pokladna-trzby'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import Obsah, { karta, NAZVY_CLENENI, type RadekOstatniTrzby } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Finance → Tržby.
 *
 * Šéfík 12. 10. 2026: „potřebuju rozdělit přehled po provozovnách
 * a platbách, firmě jako celku, dále po dnech, měsících a rocích"
 * + „dej obojí" (způsob platby z pokladny i příjmy z banky) + „dále tam
 * dej ostatní platby, to bude modul, který ještě vybudujeme".
 *
 * Všechno z jednoho dotazu `pokladna_prehled_trzeb` (SECURITY DEFINER,
 * práva ověřená jednou — finance.read + viditelné pobočky volajícího),
 * skládání v `lib/pokladna-trzby.ts`. Čísla jen ta, která appka má:
 *   * období bez prodejů je „–", ne 0 Kč;
 *   * platby po způsobu pokrývají jen dny, kdy je pokladna poslala —
 *     stránka to napíše („platby za 12 z 31 dní"), nepředstírá celek;
 *   * banka bez napojeného účtu je „–" s vysvětlením, ne 0 Kč;
 *   * „Ostatní tržby" (16. 10. 2026) jsou tržby mimo pokladnu z agendy
 *     Jiné platby (`ostatni_trzby`, jen `zapocitat = true` a platné,
 *     jen v korunách — jiné měny zvlášť větou). Mají VLASTNÍ kartu a do
 *     tržeb z pokladny se NIKDY nepřičítají: prodej, který už v pokladně
 *     je, má v `ostatni_trzby` `zapocitat = false` (docs/jine-platby-navrh.md,
 *     oddíl 2). Načítají se uživatelským klientem — RLS
 *     `app.jine_platby_vidi` pustí jen pobočky, kde člověk záznamy vidí.
 *
 * Na pobočce (Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět
 * finance, které se týkají jen Bernard Baru") je provozovna dána
 * rozsahem adresy: přepínač „Celá firma / pobočky" se nekreslí,
 * `?pobocka=` se nečte a přehled se zúží na pobočku dřív, než dojde do
 * kreslení (`jenPobocka`). Banka = jen účty té pobočky, firemní účet ne.
 * Za celou firmu beze změny, i s přepínačem.
 */

const LET_ZPET = 9

/**
 * PROVOZNÍ den (začíná v 05:00), ne kalendářní: tak je zapsaná tržba.
 * Ve 1:30 v noci 1. 11. ještě běží 31. 10. — přehled nesmí skočit na
 * prázdný listopad.
 */
function provozniDnes(): string {
  return provozniDen(Date.now(), '05:00', ZONA_VYCHOZI)
}

function jeCleneni(v: string | undefined): v is Cleneni {
  return v === 'den' || v === 'mesic' || v === 'rok'
}

/** Období stránky: od–do, popis a sousední období pro šipky. */
function urcitObdobi(cleneni: Cleneni, parametr: string | undefined, dnes: string) {
  if (cleneni === 'rok') {
    const rok = Number(dnes.slice(0, 4))
    return { od: `${rok - LET_ZPET}-01-01`, doData: dnes, popis: 'Posledních 10 let', klic: '', predchozi: null, dalsi: null }
  }
  // Budoucí (nebo nesmyslně staré) období z adresy → aktuální; jinak by dotaz dostal od > do.
  const letos = Number(dnes.slice(0, 4))
  if (cleneni === 'mesic') {
    const zadany = parametr && /^\d{4}$/.test(parametr) ? Number(parametr) : letos
    const rok = zadany >= 2000 && zadany <= letos ? zadany : letos
    const od = `${rok}-01-01`
    const konec = `${rok}-12-31`
    return {
      od,
      doData: konec < dnes ? konec : dnes,
      popis: String(rok),
      klic: String(rok),
      predchozi: String(rok - 1),
      dalsi: `${rok + 1}-01-01` <= dnes ? String(rok + 1) : null,
    }
  }
  const mesic = parametr && /^\d{4}-(0[1-9]|1[0-2])$/.test(parametr) && parametr >= '2000-01' && parametr <= dnes.slice(0, 7)
    ? parametr
    : dnes.slice(0, 7)
  const od = `${mesic}-01`
  const dalsiMesic = dalsiObdobi(od, 'mesic')
  const posledni = new Date(Date.parse(`${dalsiMesic}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const predchozi = new Date(Date.parse(`${od}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7)
  return {
    od,
    doData: posledni < dnes ? posledni : dnes,
    popis: popisObdobi(od, 'mesic'),
    klic: mesic,
    predchozi,
    dalsi: dalsiMesic <= dnes ? dalsiMesic.slice(0, 7) : null,
  }
}

export default async function FinanceTrzby({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ po?: string; obdobi?: string; pobocka?: string }>
}) {
  const { rozsah } = await params
  const { po, obdobi: obdobiParam, pobocka: pobockaParam } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Tržby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  // `null` = celá firma (s přepínačem provozoven); jinak pobočka z adresy.
  const pobockaRozsahu = pobockaFinanci(pristup.scope)
  // Banku (příjmy na účty) smí vidět jen ten, kdo má `finance.read` ZA
  // CELOU FIRMU: RLS transakcí rozsah členství nehlídá a
  // `pokladna_prehled_trzeb` (SECURITY DEFINER) vrací bankovní řádky
  // každému s finance.read. Na firmě to ověřil `zkusPristup`, na pobočce
  // `zkusPristupFinanci` (bez toho sem nepustí) — sem se tedy dostane jen on.
  const bankaVidi = true

  const cleneni: Cleneni = jeCleneni(po) ? po : 'den'
  const dnes = provozniDnes()
  const rozsahObdobi = urcitObdobi(cleneni, obdobiParam, dnes)

  const supabase = await getServerSupabase()
  const [pobockyRes, uctyRes, pokladnyRes] = await Promise.all([
    supabase.from('branches').select('id, name, active').eq('tenant_id', tenantId).is('deleted_at', null).order('name'),
    // I vypnuté účty — jejich historické příjmy přehled pořád sčítá.
    supabase.from('platebni_ucty').select('branch_id').eq('tenant_id', tenantId).eq('typ', 'banka'),
    // Pobočka a přiřazení provozoven: na pobočce se počítá jen pokladna,
    // která posílá JEJÍ tržby (`pokladnaPatriPobocce`).
    supabase.from('integrace_pripojeni').select('branch_id, externi_ucet').eq('tenant_id', tenantId).eq('oblast', 'pokladna').is('odpojeno_kdy', null),
  ])
  // Prázdný výsledek není důkaz (lib/supabase/dotaz.ts): chyba dotazu by se
  // jinak tvářila jako „banka není napojená" nebo „žádná pokladna".
  if (pobockyRes.error) throw new DotazSelhal('pobočky firmy', pobockyRes.error)
  if (uctyRes.error) throw new DotazSelhal('bankovní účty firmy', uctyRes.error)
  if (pokladnyRes.error) throw new DotazSelhal('napojené pokladny', pokladnyRes.error)
  const pobocky = (pobockyRes.data ?? []) as { id: string; name: string; active: boolean }[]
  const nazvyPobocek = new Map(pobocky.map((b) => [b.id, b.active ? b.name : `${b.name} (vypnutá)`]))
  const aktivniPobocky = pobocky.filter((b) => b.active)
  // Na pobočce je provozovna daná adresou a `?pobocka=` se nečte — jinak by
  // šlo z adresy Bernard Baru otevřít tržby Černé Perly.
  const vybranaPobocka = pobockaRozsahu ?? (pobockaParam && aktivniPobocky.some((b) => b.id === pobockaParam) ? pobockaParam : null)
  // U jedné provozovny jen její účty: firemní účet k žádné nepatří a „0 Kč"
  // by tvrdilo, že nic nepřišlo, místo „provozovna účet nemá".
  const bankovniUcty = (uctyRes.data ?? []) as { branch_id: string | null }[]
  const maBankovniUcet = vybranaPobocka ? bankovniUcty.some((u) => u.branch_id === vybranaPobocka) : bankovniUcty.length > 0
  const pokladny = (pokladnyRes.data ?? []) as { branch_id: string | null; externi_ucet: unknown }[]
  const maPokladnu = pobockaRozsahu ? pokladny.some((p) => pokladnaPatriPobocce(p, pobockaRozsahu)) : pokladny.length > 0

  let prehled: PrehledTrzeb | null = null
  let chybaNacteni = false
  try {
    prehled = await nactiPrehledTrzeb(tenantId, rozsahObdobi.od, rozsahObdobi.doData, cleneni)
  } catch {
    chybaNacteni = true
  }
  // Na pobočce dojdou do kreslení jen její řádky (tržby, platby, způsoby, banka).
  if (prehled !== null && pobockaRozsahu !== null) prehled = jenPobocka(prehled, pobockaRozsahu)

  // Ostatní tržby (Jiné platby) za totéž období a rozsah. Které řádky se
  // sčítají (zapocitat, platna) a že se měny nesčítají, rozhoduje JEDINÉ
  // místo — `souhrnOstatnichTrzeb` v obsah.tsx. `null` = tabulka zatím
  // v databázi není (migrace Jiných plateb nenasazená).
  let dotazOstatnich = supabase
    .from('ostatni_trzby')
    .select('branch_id, datum, castka_haleru, mena, zapocitat, stav')
    .eq('tenant_id', tenantId)
    .gte('datum', rozsahObdobi.od)
    .lte('datum', rozsahObdobi.doData)
  if (vybranaPobocka) dotazOstatnich = dotazOstatnich.eq('branch_id', vybranaPobocka)
  const ostatniRes = await dotazOstatnich
  if (ostatniRes.error && !tabulkaNeexistuje(ostatniRes.error)) throw new DotazSelhal('ostatní tržby', ostatniRes.error)
  const ostatniTrzby: RadekOstatniTrzby[] | null = ostatniRes.error ? null : ((ostatniRes.data ?? []) as RadekOstatniTrzby[])

  const zaklad = `/${rozsah}/finance/trzby`
  // Integrace (pokladny, prodeje po produktech) patří celé firmě — z pobočky rovnou tam.
  const zakladIntegraci = `/${pobockaRozsahu ? TENANT_SCOPE_SEGMENT : rozsah}/finance/integrace`
  const odkaz = (zmena: { po?: Cleneni; obdobi?: string | null; pobocka?: string | null }) => {
    const p = new URLSearchParams()
    const c = zmena.po ?? cleneni
    if (c !== 'den') p.set('po', c)
    // Přepnutí členění bez výslovného období: ze dnů na měsíce zůstane rok
    // zobrazeného měsíce, jinak výchozí (teď). Z „Po rocích" ne — tam `od`
    // ukazuje deset let zpátky a měsíce by se otevřely v roce bez dat.
    const vychoziPriPrepnuti = c === 'mesic' && cleneni === 'den' ? rozsahObdobi.od.slice(0, 4) : ''
    const o = zmena.obdobi === undefined ? (c !== cleneni ? vychoziPriPrepnuti : rozsahObdobi.klic) : zmena.obdobi
    if (o) p.set('obdobi', o)
    // Na pobočce ji nese adresa, ne parametr.
    const b = pobockaRozsahu ? null : zmena.pobocka === undefined ? vybranaPobocka : zmena.pobocka
    if (b) p.set('pobocka', b)
    const q = p.toString()
    return q ? `${zaklad}?${q}` : zaklad
  }

  const nazevRozsahu = vybranaPobocka ? (nazvyPobocek.get(vybranaPobocka) ?? pristup.scope.branchName ?? 'Provozovna') : 'Celá firma'

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={
          pobockaRozsahu
            ? `Jen ${nazevRozsahu}: tržby z její pokladny po způsobech platby, vedle nich příjmy na její bankovní účty. Appka počítá, nikdy neodhaduje.`
            : 'Tržby z pokladen po provozovnách a způsobech platby, vedle nich příjmy na bankovní účty. Appka počítá, nikdy neodhaduje.'
        }
        vpravo={
          rozsahObdobi.predchozi !== null ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Link href={odkaz({ obdobi: rozsahObdobi.predchozi })} className="ft-tl">← Dřívější</Link>
              <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{rozsahObdobi.popis}</span>
              {rozsahObdobi.dalsi !== null ? (
                <Link href={odkaz({ obdobi: rozsahObdobi.dalsi })} className="ft-tl">Pozdější →</Link>
              ) : (
                <span className="ft-tl" aria-disabled="true" style={{ opacity: 0.4, pointerEvents: 'none' }}>Pozdější →</span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{rozsahObdobi.popis}</span>
          )
        }
      >
        {pobockaRozsahu ? `Tržby — ${nazevRozsahu}` : 'Tržby'}
      </Nadpis>

      {/* containerType: karty `.ds-kpi-mrizka` se skládají podle šířky obsahu (@container) — bez kontejneru zůstaly na telefonu čtyři vedle sebe. */}
      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', containerType: 'inline-size' }}>
        <nav className="ds-zalozky" aria-label="Členění" style={{ margin: 0 }}>
          {(['den', 'mesic', 'rok'] as const).map((c) => (
            <Link key={c} href={odkaz({ po: c })} aria-current={c === cleneni ? 'page' : undefined}>
              {NAZVY_CLENENI[c]}
            </Link>
          ))}
        </nav>

        {/* Přepínač provozoven jen za celou firmu — na pobočce ji určuje adresa (přepínač rozsahu nahoře). */}
        {pobockaRozsahu ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{POZNAMKA_FIREMNI}</p>
        ) : (
          <div role="group" aria-label="Provozovna" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link href={odkaz({ pobocka: null })} className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-current={vybranaPobocka === null ? 'true' : undefined}>
              Celá firma
            </Link>
            {aktivniPobocky.map((b) => (
              <Link key={b.id} href={odkaz({ pobocka: b.id })} className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-current={vybranaPobocka === b.id ? 'true' : undefined}>
                {b.name}
              </Link>
            ))}
          </div>
        )}

        {chybaNacteni ? (
          <p className="hlaska-chyba" style={{ margin: 0 }}>Přehled tržeb se nepodařilo načíst. Zkuste stránku obnovit.</p>
        ) : prehled === null ? (
          <div style={karta}>
            <h2 style={{ margin: '0 0 6px', fontSize: '15px' }}>Přehled tržeb čeká na aktualizaci databáze</h2>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              Kód je nasazený dřív než úprava databáze. Jakmile proběhne, objeví se tady tržby z pokladen po dnech, měsících a rocích.
            </p>
          </div>
        ) : (
          <Obsah
            prehled={prehled}
            cleneni={cleneni}
            od={rozsahObdobi.od}
            doData={rozsahObdobi.doData}
            vybranaPobocka={vybranaPobocka}
            nazevRozsahu={nazevRozsahu}
            nazvyPobocek={nazvyPobocek}
            poradiPobocek={aktivniPobocky.map((b) => b.id)}
            bankaVidi={bankaVidi}
            maBankovniUcet={maBankovniUcet}
            maPokladnu={maPokladnu}
            zakladIntegraci={zakladIntegraci}
            odkazNaObdobi={(o) => (cleneni === 'rok' ? odkaz({ po: 'mesic', obdobi: o.slice(0, 4) }) : cleneni === 'mesic' ? odkaz({ po: 'den', obdobi: o.slice(0, 7) }) : null)}
            odkazNaPobocku={(id) => odkaz({ pobocka: id })}
            ostatniTrzby={ostatniTrzby}
            zakladJinychPlateb={`/${rozsah}/finance/trzby/jine-platby`}
          />
        )}
      </div>
    </Navigace>
  )
}
