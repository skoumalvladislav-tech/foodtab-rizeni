import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { pristupKFakturam } from '@/lib/supabase/faktury'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import { pripojitEmailSchranku, odpojitEmailSchranku } from './akce'
import PrijemFaktur from './prijem-faktur'

export const dynamic = 'force-dynamic'
// „Zpracovat teď" (spustitPrijemTed) běží až ~45 s — akce dědí limit stránky.
export const maxDuration = 60

/**
 * Finance — Integrace — E-mail.
 *
 * IMAP schránka: appka přihlašovací údaje PŘED uložením živě ověří
 * (`lib/integrace-mail-imap.ts`) — stejný vzor jako Fio.
 *
 * Příjem faktur (Šéfík 7.–8. 10. 2026, otázka 42): u každé schránky se
 * dá zapnout; appka ji pak sama prochází a faktury z příloh zapisuje do
 * Faktur jako dřív n8n (lib/faktury-prijem-*.ts, panel prijem-faktur.tsx).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const NAZVY_STAVU: Record<string, { text: string; barva: string; bg: string }> = {
  nepripojeno: { text: 'Čeká na připojení', barva: 'var(--muted)', bg: 'var(--sunken)' },
  pripojeno: { text: 'Připojeno', barva: 'var(--dobre)', bg: 'var(--dobre-bg)' },
  vyzaduje_pozornost: { text: 'Vyžaduje pozornost', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
  chyba: { text: 'Chyba', barva: 'var(--bad)', bg: 'var(--bad-bg)' },
  odpojeno: { text: 'Odpojeno', barva: 'var(--muted)', bg: 'var(--sunken)' },
}

function Stitek({ stav }: { stav: string }) {
  const s = NAZVY_STAVU[stav] ?? NAZVY_STAVU.nepripojeno
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: s.bg, color: s.barva }}>
      {s.text}
    </span>
  )
}

type Pripojeni = {
  id: string
  nazev: string
  stav: string
  posledni_test_kdy: string | null
  posledni_chyba: string | null
  posledni_sync_kdy: string | null
  externi_ucet: { host?: string; port?: number; zabezpeceni?: string; uzivatel?: string; pocet_slozek?: number; prijem_dokladu?: unknown } | null
}

export default async function FinanceIntegraceEmail({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; zprava?: string }>
}) {
  const { rozsah } = await params
  const { chyba, zprava } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">E-mail vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'integrace.manage')
  // Příjem faktur zapisuje do Faktur: čísla vidí kdo vidí Faktury, ovládá kdo je i spravuje.
  const vidiFaktury = canSee(pristup.ctx, 'faktury.read')
  const smiPrijem = smiPsat && canSee(pristup.ctx, 'faktury.manage')
  const databazeFakturOk = vidiFaktury ? (await pristupKFakturam(tenantId)).stav === 'ok' : false
  const dnes = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())
  const supabase = await getServerSupabase()

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, nazev, stav, posledni_test_kdy, posledni_chyba, posledni_sync_kdy, externi_ucet')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'email_dokladu')
    .is('odpojeno_kdy', null)
    .order('nazev')

  const pripojeni = (data ?? []) as Pripojeni[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="IMAP schránka — appka ověří přístup a uloží přihlašovací údaje. U schránky pak jde zapnout příjem faktur: appka ji sama prochází a faktury zapisuje do Faktur."
        vpravo={<Link href={`/${rozsah}/finance/integrace`} className="ft-tl">← Zpět na integrace</Link>}
      >
        E-mail
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {zprava ? <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>{zprava}</p> : null}

        {pripojeni.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádná e-mailová schránka.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {pripojeni.map((p) => (
              <div key={p.id} style={{ ...karta, display: 'grid', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{p.nazev}</strong>
                    <Stitek stav={p.stav} />
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                    {p.externi_ucet?.host ? `${p.externi_ucet.host}:${p.externi_ucet.port} (${p.externi_ucet.zabezpeceni})` : '—'}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {p.posledni_test_kdy
                    ? `Ověřeno: ${new Date(p.posledni_test_kdy).toLocaleString('cs-CZ')} · ${p.externi_ucet?.pocet_slozek ?? 0} složek`
                    : 'Ještě neověřeno.'}
                  {p.posledni_chyba ? <span style={{ color: 'var(--bad)' }}> — {p.posledni_chyba}</span> : null}
                </div>
                {vidiFaktury ? (
                  <PrijemFaktur
                    rozsah={rozsah}
                    pripojeniId={p.id}
                    prijemSurovy={p.externi_ucet?.prijem_dokladu}
                    posledniBeh={p.posledni_sync_kdy}
                    smiMenit={smiPrijem}
                    databazeFakturOk={databazeFakturOk}
                    dnes={dnes}
                  />
                ) : null}
                {smiPsat ? (
                  <form action={odpojitEmailSchranku}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="ft-tl">Odpojit</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {smiPsat ? (
          <form action={pripojitEmailSchranku} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Připojit schránku (IMAP)</h2>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              U Gmailu/Outlooku použijte aplikační heslo, ne hlavní heslo k účtu. Appka přístup před uložením živě ověří.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>Název (volitelné)</span>
                <input type="text" name="nazev" placeholder="např. Faktury — hlavní schránka" style={pole} />
              </label>
              <label>
                <span style={popisek}>Server (IMAP host) *</span>
                <input type="text" name="host" required placeholder="imap.example.cz" style={pole} />
              </label>
              <label>
                <span style={popisek}>Port *</span>
                <input type="number" name="port" required defaultValue={993} style={pole} />
              </label>
              <label>
                <span style={popisek}>Zabezpečení *</span>
                <select name="zabezpeceni" required defaultValue="tls" style={pole}>
                  <option value="tls">TLS (obvykle port 993)</option>
                  <option value="starttls">STARTTLS (obvykle port 143)</option>
                </select>
              </label>
              <label>
                <span style={popisek}>Přihlašovací jméno *</span>
                <input type="text" name="uzivatel" required placeholder="faktury@vasefirma.cz" style={pole} />
              </label>
              <label>
                <span style={popisek}>Heslo *</span>
                <input type="password" name="heslo" required autoComplete="off" style={pole} />
              </label>
            </div>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Ověřit a připojit</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
