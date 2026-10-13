import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { ZONA_VYCHOZI } from '@/lib/cas'
import { provozniDen } from '@/lib/pokladna-cas'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { nactiPrehledTrzeb } from '@/lib/pokladna-trzby-nacteni'
import { dalsiObdobi, popisObdobi, type Cleneni, type PrehledTrzeb } from '@/lib/pokladna-trzby'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import Obsah, { karta, NAZVY_CLENENI } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Finance → Tržby.
 *
 * Šéfík 12. 10. 2026: „potřebuju rozdělit přehled po provozovnách
 * a platbách, firmě jako celku, dále po dnech, měsících a rocích"
 * + „dej obojí" (způsob platby z pokladny i příjmy z banky) + „dále tam
 * dej ostatní platby, to bude modul, který ještě vybudujeme".
 *
 * Všechno z jednoho dotazu `pokladna_prehled_trzeb` (RLS volajícího),
 * skládání v `lib/pokladna-trzby.ts`. Čísla jen ta, která appka má:
 *   * období bez prodejů je „–", ne 0 Kč;
 *   * platby po způsobu pokrývají jen dny, kdy je pokladna poslala —
 *     stránka to napíše („platby za 12 z 31 dní"), nepředstírá celek;
 *   * banka bez napojeného účtu je „–" s vysvětlením, ne 0 Kč;
 *   * „Ostatní platby" jsou modul, který zatím neexistuje — karta to
 *     říká, žádné číslo si nevymýšlí.
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

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Tržby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const cleneni: Cleneni = jeCleneni(po) ? po : 'den'
  const dnes = provozniDnes()
  const rozsahObdobi = urcitObdobi(cleneni, obdobiParam, dnes)
  // Finance se otevírá jen na firemní úrovni (layout) a příjmy z banky vrací
  // přehled podle stejných práv jako RLS transakcí — firemní účty a účty
  // viditelných poboček.
  const bankaVidi = pristup.scope.level === 'tenant'

  const supabase = await getServerSupabase()
  const [pobockyRes, uctyRes, pokladnyRes] = await Promise.all([
    supabase.from('branches').select('id, name, active').eq('tenant_id', tenantId).is('deleted_at', null).order('name'),
    // I vypnuté účty — jejich historické příjmy přehled pořád sčítá.
    supabase.from('platebni_ucty').select('branch_id').eq('tenant_id', tenantId).eq('typ', 'banka'),
    supabase.from('integrace_pripojeni').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('oblast', 'pokladna').is('odpojeno_kdy', null),
  ])
  // Prázdný výsledek není důkaz (lib/supabase/dotaz.ts): chyba dotazu by se
  // jinak tvářila jako „banka není napojená" nebo „žádná pokladna".
  if (pobockyRes.error) throw new DotazSelhal('pobočky firmy', pobockyRes.error)
  if (uctyRes.error) throw new DotazSelhal('bankovní účty firmy', uctyRes.error)
  if (pokladnyRes.error) throw new DotazSelhal('napojené pokladny', pokladnyRes.error)
  const pobocky = (pobockyRes.data ?? []) as { id: string; name: string; active: boolean }[]
  const nazvyPobocek = new Map(pobocky.map((b) => [b.id, b.active ? b.name : `${b.name} (vypnutá)`]))
  const aktivniPobocky = pobocky.filter((b) => b.active)
  const vybranaPobocka = pobockaParam && aktivniPobocky.some((b) => b.id === pobockaParam) ? pobockaParam : null
  // U jedné provozovny jen její účty: firemní účet k žádné nepatří a „0 Kč"
  // by tvrdilo, že nic nepřišlo, místo „provozovna účet nemá".
  const bankovniUcty = (uctyRes.data ?? []) as { branch_id: string | null }[]
  const maBankovniUcet = vybranaPobocka ? bankovniUcty.some((u) => u.branch_id === vybranaPobocka) : bankovniUcty.length > 0
  const maPokladnu = (pokladnyRes.count ?? 0) > 0

  let prehled: PrehledTrzeb | null = null
  let chybaNacteni = false
  try {
    prehled = await nactiPrehledTrzeb(tenantId, rozsahObdobi.od, rozsahObdobi.doData, cleneni)
  } catch {
    chybaNacteni = true
  }

  const zaklad = `/${rozsah}/finance/trzby`
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
    const b = zmena.pobocka === undefined ? vybranaPobocka : zmena.pobocka
    if (b) p.set('pobocka', b)
    const q = p.toString()
    return q ? `${zaklad}?${q}` : zaklad
  }

  const nazevRozsahu = vybranaPobocka ? (nazvyPobocek.get(vybranaPobocka) ?? 'Provozovna') : 'Celá firma'

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Tržby z pokladen po provozovnách a způsobech platby, vedle nich příjmy na bankovní účty. Appka počítá, nikdy neodhaduje."
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
        Tržby
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
            rozsah={rozsah}
            odkazNaObdobi={(o) => (cleneni === 'rok' ? odkaz({ po: 'mesic', obdobi: o.slice(0, 4) }) : cleneni === 'mesic' ? odkaz({ po: 'den', obdobi: o.slice(0, 7) }) : null)}
            odkazNaPobocku={(id) => odkaz({ pobocka: id })}
          />
        )}
      </div>
    </Navigace>
  )
}
