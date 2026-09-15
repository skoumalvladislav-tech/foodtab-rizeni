import { redirect } from 'next/navigation'

import { denVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { cteniZObrazkuJeNastavene } from '@/lib/marketing-menu-ai'
import { DRUHY_MENU } from '@/lib/marketing-menu-tabulka'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { zalozitMenuRucne, zalozitMenuZeSouboru, zalozitMenuZTextu } from '../../akce'

export const dynamic = 'force-dynamic'

/**
 * Nové menu — čtyři cesty na jedné obrazovce.
 *
 * Zadání krok 2: ruční formulář / vložit text / fotografie / PDF,
 * jako záložky. Vzor: `marketing-ai/app/[provozovna]/menu/nove/page.tsx`
 * (git show 6cb7d72) — přepínání záložek je tam prostý odkaz se
 * `?zpusob=`, ne klientský stav, takže se dá otevřít přímým odkazem
 * a funguje i bez JS. Přebíráno stejně.
 *
 * Schopnosti (text bez AI, fotka a PDF s AI) už existovaly na staré
 * `marketing/menu`; ruční formulář byl v modulu jediná chybějící část
 * — `zalozitMenuRucne` v `akce.ts` je z téhle práce.
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

const poleMale = { ...pole, padding: '5px 6px', fontSize: '13px' } as const
const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const KATEGORIE = [
  { klic: 'polevka', nazev: 'Polévka' },
  { klic: 'predkrm', nazev: 'Předkrm' },
  { klic: 'hlavni', nazev: 'Hlavní' },
  { klic: 'dezert', nazev: 'Dezert' },
  { klic: 'napoj', nazev: 'Nápoj' },
  { klic: 'ostatni', nazev: 'Ostatní' },
]

const DOSTUPNOST = [
  { klic: 'k_dispozici', nazev: 'K dispozici' },
  { klic: 'omezeno', nazev: 'Omezeně' },
  { klic: 'vyprodano', nazev: 'Vyprodáno' },
]

const RADKU_RUCNE = 8

const ZALOZKY = [
  { klic: 'rucne', nazev: 'Ruční formulář' },
  { klic: 'text', nazev: 'Vložit text' },
  { klic: 'foto', nazev: 'Fotografie' },
  { klic: 'pdf', nazev: 'PDF' },
] as const

export default async function NoveMenu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ zpusob?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { zpusob, chyba } = await searchParams
  const zp = ZALOZKY.some((z) => z.klic === zpusob) ? zpusob! : 'rucne'

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Nové menu založí ten, kdo má právo „Spravovat marketing“.
      </Sdeleni>
    )
  }

  const cteniZObrazku = cteniZObrazkuJeNastavene()
  const supabase = await getServerSupabase()

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId).order('name'),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )
  const dnes = denVPasmu(new Date(), firma[0]?.timezone ?? ZONA_VYCHOZI)

  const zalozka = (klic: string) => `/${rozsah}/marketing/menu/nove?zpusob=${klic}`

  const vyberProvozovnyADruhu = (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      <label style={{ flex: '1 1 200px' }}>
        <span style={popisek}>Provozovna</span>
        <select name="pobocka" style={pole} defaultValue={pobocky[0]?.id ?? ''}>
          {pobocky.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label style={{ flex: '1 1 160px' }}>
        <span style={popisek}>Druh</span>
        <select name="druh" style={pole} defaultValue="denni">
          {DRUHY_MENU.map((d) => (
            <option key={d.klic} value={d.klic}>{d.nazev}</option>
          ))}
        </select>
      </label>
    </div>
  )

  return (
    <>
      <Nadpis oci="Marketing" popis="Čtyři cesty. Rozpoznaná data vždy zkontrolujete a potvrdíte, než se použijí.">
        Nové menu
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {ZALOZKY.map((z) => (
            <a
              key={z.klic}
              href={zalozka(z.klic)}
              className="ft-tl ft-tl-male"
              style={z.klic === zp ? { borderColor: 'var(--mosaz)' } : undefined}
              aria-current={z.klic === zp ? 'page' : undefined}
            >
              {z.nazev}
            </a>
          ))}
        </div>

        {zp === 'rucne' ? (
          <form action={zalozitMenuRucne} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />

            {vyberProvozovnyADruhu}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 200px' }}>
                <span style={popisek}>Název</span>
                <input name="nazev" style={pole} placeholder="např. Denní menu" />
              </label>
              <label style={{ flex: '1 1 140px' }}>
                <span style={popisek}>Platí od</span>
                <input name="plati_od" type="date" style={pole} defaultValue={dnes} required />
              </label>
              <label style={{ flex: '1 1 140px' }}>
                <span style={popisek}>Platí do</span>
                <input name="plati_do" type="date" style={pole} />
              </label>
            </div>

            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Položky</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Cena v Kč, alergeny čísly oddělenými čárkou. <strong>Prázdná cena se označí ke
                kontrole</strong> — cena se nikdy nedomýšlí, doplníte ji později. Prázdné řádky
                se přeskočí.
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: '12px' }}>
                    <th style={{ padding: '0 4px 6px' }}>Kategorie</th>
                    <th style={{ padding: '0 4px 6px' }}>Název</th>
                    <th style={{ padding: '0 4px 6px' }}>Popis</th>
                    <th style={{ padding: '0 4px 6px' }}>Cena</th>
                    <th style={{ padding: '0 4px 6px' }}>Alergeny</th>
                    <th style={{ padding: '0 4px 6px' }}>Dostupnost</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: RADKU_RUCNE }).map((_, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 4px' }}>
                        <select name={`kategorie_${i}`} style={poleMale} defaultValue={i === 0 ? 'polevka' : i >= 5 ? 'dezert' : 'hlavni'}>
                          {KATEGORIE.map((k) => (
                            <option key={k.klic} value={k.klic}>{k.nazev}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input name={`nazev_${i}`} style={{ ...poleMale, minWidth: '140px' }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input name={`popis_${i}`} style={{ ...poleMale, minWidth: '140px' }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input name={`cena_${i}`} inputMode="decimal" style={{ ...poleMale, width: '80px' }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input name={`alergeny_${i}`} placeholder="1,3,7" style={{ ...poleMale, width: '80px' }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <select name={`dostupnost_${i}`} style={poleMale} defaultValue="k_dispozici">
                          {DOSTUPNOST.map((d) => (
                            <option key={d.klic} value={d.klic}>{d.nazev}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit menu</button>
            </div>
          </form>
        ) : null}

        {zp === 'text' ? (
          <form action={zalozitMenuZTextu} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />

            {vyberProvozovnyADruhu}

            <label>
              <span style={popisek}>Text menu</span>
              <textarea
                name="text"
                rows={10}
                style={{ ...pole, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
                placeholder={`Denní menu ${dnes.split('-').reverse().join('. ')}\nPolévka\nHovězí vývar 45 Kč\nHlavní jídla\nSvíčková na smetaně 189 Kč`}
              />
              <small style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                Zkopírujte menu, jak ho máte — z e-mailu, z Wordu, z tabule. Poznají se ceny,
                alergeny v závorce a kategorie podle nadpisu. <strong>Co se nepřečte, zůstane
                prázdné a označí se ke kontrole.</strong>
              </small>
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Načíst menu</button>
            </div>
          </form>
        ) : null}

        {(zp === 'foto' || zp === 'pdf') ? (
          cteniZObrazku ? (
            <form action={zalozitMenuZeSouboru} style={{ ...karta, display: 'grid', gap: '12px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />

              {vyberProvozovnyADruhu}

              <label>
                <span style={popisek}>{zp === 'foto' ? 'Fotografie nebo screenshot menu' : 'PDF s menu'}</span>
                <input
                  type="file"
                  name="soubor"
                  accept={zp === 'foto' ? 'image/jpeg,image/png,image/webp' : 'application/pdf'}
                  style={pole}
                />
                <small style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                  Do 8 MB. Přečte se z toho, co je čitelné — <strong>rozmazaná cena zůstane
                  prázdná</strong>, nikdy se nedoplní odhadem.
                </small>
              </label>

              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Přečíst a zkontrolovat</button>
              </div>
            </form>
          ) : (
            <div style={karta}>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Čtení z fotky a PDF potřebuje připojenou AI. Než ji připojíte,
                vkládejte menu ručně nebo textem — funguje to bez ní a nic to nehádá.
              </p>
            </div>
          )
        ) : null}
      </div>
    </>
  )
}
