import Link from 'next/link'
import { redirect } from 'next/navigation'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  OKNA,
  okno,
  popisEntity,
  popisKonatele,
  popisUkonu,
  popisZmen,
} from '@/lib/marketing-audit'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { funkceNeexistuje, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Auditní přehled marketingu — kdo co schválil a zveřejnil.
 *
 * Zadání: master prompt, obrazovka 16 z oddílu 22 („Tým, role
 * a auditní přehled") a oddíl 23 („audit důležitých akcí").
 *
 * ---------------------------------------------------------------------
 * TÝM A ROLE TADY NEJSOU, A JE TO SPRÁVNĚ
 *
 * Obrazovka 16 v zadání spojuje tři věci: tým, role a audit. První dvě
 * ve Foodtabu **už jsou** — Lidé a Zařazení v Nastavení, společné pro
 * všechny moduly. Udělat marketingu vlastní správu lidí by znamenalo
 * druhé místo, kde se přidělují práva, a ta dvě se dřív nebo později
 * rozejdou (CLAUDE.md, pravidlo 2).
 *
 * Zbývá tedy audit — a ten vlastní být musí, protože ten obecný
 * marketér neuvidí. Viz hlavička migrace 20260914200000.
 *
 * ---------------------------------------------------------------------
 * ČTE SE FUNKCÍ, NE TABULKOU
 *
 * `audit_log` přečte jen `settings.manage` nebo `agents.manage`, tedy
 * majitel. Kdyby se politika rozšířila kvůli téhle obrazovce, otevřel
 * by se marketérovi celý audit firmy včetně mezd a docházky.
 *
 * `public.marketing_audit` je proto úzké okno: jen entity `marketing_*`
 * a jen tam, kam člověk vidí. A vrací **názvy** změněných polí, ne
 * jejich hodnoty — audit má říct kdo, co a kdy, ne být druhou kopií
 * dat.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

type Zaznam = {
  id: number
  kdy: string
  kdo: string | null
  druh_kdo: string
  akce: string
  entita: string
  entita_id: string | null
  branch_id: string | null
  zmeneno: string[] | null
}

export default async function Audit({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ okno?: string; druh?: string; pred?: string }>
}) {
  const { rozsah } = await params
  const q = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  /*
    `marketing.manage`, ne `marketing.read`. Kdo si smí marketing jen
    přečíst, nemá vidět, kdo co komu vrátil k přepracování — to je
    věc toho, kdo modul řídí.
  */
  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Auditní přehled vidí ten, kdo má právo „Spravovat marketing“.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )
  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const zonyPobocek = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const jmenaPobocek = new Map(pobocky.map((p) => [p.id, p.name]))
  const zona = (b: string | null) => (b ? zonyPobocek.get(b) : null) ?? zonaFirmy

  const vybrane = okno(q.okno)

  /*
    HRANICE OKNA SE POČÍTÁ OD PŮLNOCI, ne „před 168 hodinami“. Jinak by
    přehled po každém načtení vypadal jinak a záznam ze začátku okna by
    z něj v poledne vypadl.

    Půlnoc se bere v pásmu FIRMY. Pobočky můžou mít každá své, ale okno
    je jedno pro celý výpis — kdyby se počítalo pro každý řádek zvlášť,
    nešlo by říct, co v seznamu vlastně je.
  */
  const hranice = (() => {
    if (vybrane.dnu === 0) return null
    const ted = new Date()
    const dnesVPasmu = new Date(ted.toLocaleString('en-US', { timeZone: zonaFirmy }))
    dnesVPasmu.setHours(0, 0, 0, 0)
    dnesVPasmu.setDate(dnesVPasmu.getDate() - vybrane.dnu + 1)
    return dnesVPasmu.toISOString()
  })()

  const dotaz = await supabase.rpc('marketing_audit', {
    p_tenant: tenantId,
    p_branch: null,
    p_entita: q.druh ?? null,
    p_pred_id: q.pred ? Number(q.pred) : null,
    p_limit: 100,
  })

  if (funkceNeexistuje(dotaz.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Auditní přehled</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Přehled zatím není v databázi">
            Migrace <code>20260914200000_marketing_audit.sql</code> ještě neproběhla.
            Nasazuje je Šéfík z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const vse = await seznam<Zaznam>('auditní přehled', Promise.resolve(dotaz))
  const zaznamy = hranice ? vse.filter((z) => z.kdy >= hranice) : vse

  const druhy = await seznam<{ entita: string; kusu: number }>(
    'druhy záznamů',
    supabase.rpc('marketing_audit_druhy', { p_tenant: tenantId }),
  ).catch(() => [])

  const adresa = (zmeny: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (q.okno) p.set('okno', q.okno)
    if (q.druh) p.set('druh', q.druh)
    for (const [k, v] of Object.entries(zmeny)) {
      if (v === undefined) p.delete(k)
      else p.set(k, v)
    }
    const s = p.toString()
    return s ? `/${rozsah}/marketing/audit?${s}` : `/${rozsah}/marketing/audit`
  }

  return (
    <>
      <Nadpis oci="Marketing">Auditní přehled</Nadpis>

      <div style={{ padding: '16px', display: 'grid', gap: '16px' }}>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '14px' }}>
          Kdo co v marketingu změnil. Záznamy se nedají upravit ani smazat —
          hlídá to databáze, ne dohoda.
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {OKNA.map((o) => (
            <Link
              key={o.klic}
              href={adresa({ okno: o.klic, pred: undefined })}
              className="ft-tl ft-tl-male"
              style={o.klic === vybrane.klic ? { borderColor: 'var(--mosaz)' } : undefined}
            >
              {o.popis}
            </Link>
          ))}
        </div>

        {druhy.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link
              href={adresa({ druh: undefined, pred: undefined })}
              className="ft-tl ft-tl-male"
              style={!q.druh ? { borderColor: 'var(--mosaz)' } : undefined}
            >
              vše
            </Link>
            {druhy.map((d) => (
              <Link
                key={d.entita}
                href={adresa({ druh: d.entita, pred: undefined })}
                className="ft-tl ft-tl-male"
                style={q.druh === d.entita ? { borderColor: 'var(--mosaz)' } : undefined}
              >
                {popisEntity(d.entita)} ({d.kusu})
              </Link>
            ))}
          </div>
        )}

        {zaznamy.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0 }}>
              {vse.length === 0
                ? 'Zatím se nic nezaznamenalo.'
                : `V tomhle okně nic není. Zkuste ${OKNA[OKNA.length - 1].popis}.`}
            </p>
          </div>
        ) : (
          <div style={{ ...karta, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Kdy</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Kdo</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Co</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Změnilo se</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Pobočka</th>
                </tr>
              </thead>
              <tbody>
                {zaznamy.map((z) => (
                  <tr key={z.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {datumACasVPasmu(z.kdy, zona(z.branch_id))}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{popisKonatele(z.kdo, z.druh_kdo)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {popisEntity(z.entita)} — {popisUkonu(z.akce)}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {popisZmen(z.zmeneno)}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {z.branch_id ? (jmenaPobocek.get(z.branch_id) ?? '—') : 'celá firma'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
          STRÁNKUJE SE PŘES „STARŠÍ NEŽ TENHLE ZÁZNAM“, ne přes offset.
          Audit pořád roste a offset by při každém novém záznamu posunul
          okno tak, že by jeden řádek přeskočil.
        */}
        {zaznamy.length >= 100 && (
          <div>
            <Link
              href={adresa({ pred: String(zaznamy[zaznamy.length - 1].id) })}
              className="ft-tl ft-tl-male"
            >
              Starší záznamy
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
