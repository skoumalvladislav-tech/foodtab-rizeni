import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, isModuleActive } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import FormularPrijem from './formular-prijem'

export const dynamic = 'force-dynamic'

type Polozka = {
  id: string
  nazev: string
  jednotka: string
  mnozstvi_objednano: number
  cena_za_jednotku_haleru: number
  mnozstvi_prijato: number
  mnozstvi_fakturovano: number
}

type Prijemka = { id: string; cislo: string; datum_prijeti: string; faktura_id: string | null; poznamka: string }

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

export default async function FinanceNakupDetail({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; objednavka: string }>
  searchParams: Promise<{ chyba?: string; prijato?: string; upozorneni?: string }>
}) {
  const { rozsah, objednavka: objednavkaId } = await params
  const { chyba, prijato, upozorneni } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'purchasing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Nákup vidí ten, kdo má právo „Vidět objednávky a sklad“.</Sdeleni>
  }
  if (!isModuleActive(pristup.ctx, 'objednavky')) {
    return <Sdeleni nadpis="Modul Objednávky není zapnutý">Nákup potřebuje aktivní modul „Objednávky“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'purchasing.manage')
  const supabase = await getServerSupabase()

  const [objednavkaRes, polozkyRes, prijemkyRes] = await Promise.all([
    supabase
      .from('objednavky_dodavatelum')
      .select('id, cislo, stav, branch_id, datum_objednani, pozadovane_datum_dodani, poznamka, kontakty(nazev)')
      .eq('tenant_id', tenantId)
      .eq('id', objednavkaId)
      .maybeSingle(),
    supabase
      .from('objednavky_polozky')
      .select('id, nazev, jednotka, mnozstvi_objednano, cena_za_jednotku_haleru, mnozstvi_prijato, mnozstvi_fakturovano')
      .eq('tenant_id', tenantId)
      .eq('objednavka_id', objednavkaId),
    supabase
      .from('prijemky')
      .select('id, cislo, datum_prijeti, faktura_id, poznamka')
      .eq('tenant_id', tenantId)
      .eq('objednavka_id', objednavkaId)
      .order('datum_prijeti', { ascending: false }),
  ])

  const objednavkaData = objednavkaRes.data as { id: string; cislo: string; stav: string; branch_id: string | null; datum_objednani: string; pozadovane_datum_dodani: string | null; poznamka: string; kontakty: { nazev: string } | { nazev: string }[] | null } | null
  if (!objednavkaData) return <Sdeleni nadpis="Objednávka nenalezena">Zkontrolujte adresu nebo se vraťte na seznam.</Sdeleni>

  const dodavatel = Array.isArray(objednavkaData.kontakty) ? objednavkaData.kontakty[0]?.nazev : objednavkaData.kontakty?.nazev
  const polozky = (polozkyRes.data ?? []) as Polozka[]
  const prijemky = (prijemkyRes.data ?? []) as Prijemka[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={`Dodavatel: ${dodavatel ?? '—'} · objednáno ${objednavkaData.datum_objednani}`}
        vpravo={<Link href={`/${rozsah}/finance/nakup`} className="ft-tl">← Zpět na Nákup</Link>}
      >
        Objednávka {objednavkaData.cislo}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {prijato ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>Příjem zapsán.</p> : null}
        {upozorneni ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>
            Příjem zapsán, ale POZOR: u některé položky je přijaté množství vyšší než objednané, nebo se liší cena — zkontrolujte tabulku níže.
          </p>
        ) : null}

        <div style={{ ...karta, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '6px 8px' }}>Položka</th>
                <th style={{ padding: '6px 8px' }}>Objednáno</th>
                <th style={{ padding: '6px 8px' }}>Přijato</th>
                <th style={{ padding: '6px 8px' }}>Zbývá</th>
                <th style={{ padding: '6px 8px' }}>Cena/j.</th>
              </tr>
            </thead>
            <tbody>
              {polozky.map((p) => {
                const zbyva = p.mnozstvi_objednano - p.mnozstvi_prijato
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '6px 8px' }}>{p.nazev}</td>
                    <td style={{ padding: '6px 8px' }}>{p.mnozstvi_objednano} {p.jednotka}</td>
                    <td style={{ padding: '6px 8px', color: p.mnozstvi_prijato > p.mnozstvi_objednano ? 'var(--pozor)' : undefined }}>
                      {p.mnozstvi_prijato} {p.jednotka}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{zbyva > 0 ? `${zbyva} ${p.jednotka}` : 'hotovo'}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(p.cena_za_jednotku_haleru)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {prijemky.length > 0 ? (
          <section style={{ display: 'grid', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Příjemky</h2>
            {prijemky.map((p) => (
              <div key={p.id} style={{ ...karta, fontSize: '13px' }}>
                <strong>{p.cislo}</strong> · {p.datum_prijeti}
                {p.faktura_id ? ` · faktura ${p.faktura_id}` : ''}
                {p.poznamka ? ` · ${p.poznamka}` : ''}
              </div>
            ))}
          </section>
        ) : null}

        {smiPsat && polozky.length > 0 ? (
          <FormularPrijem
            rozsah={rozsah}
            objednavkaId={objednavkaData.id}
            branchId={objednavkaData.branch_id}
            radky={polozky.map((p) => ({
              id: p.id,
              nazev: p.nazev,
              jednotka: p.jednotka,
              zbyva: p.mnozstvi_objednano - p.mnozstvi_prijato,
              cenaKc: (p.cena_za_jednotku_haleru / 100).toFixed(2),
            }))}
          />
        ) : null}
      </div>
    </Navigace>
  )
}
