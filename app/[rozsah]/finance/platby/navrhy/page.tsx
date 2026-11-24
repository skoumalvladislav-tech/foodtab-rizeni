import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import { hlaskaBrany } from '@/lib/faktury-brana'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import { DUVODY_NAVRHU, jeVKorunach, navrhPlati, type DuvodNavrhu } from '@/lib/finance-parovani'
import { protistranaNeboUcet } from '@/lib/banka/ucet'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import Sdeleni from '@/app/sdeleni'
import SdeleniPobockyBezFirmy from '../../pobocka-bez-firmy'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import { najitNavrhyTed, odmitnoutNavrh, potvrditNavrh, uhraditVJineMene } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Finance → Platby → Návrhy párování (Finance Fáze 0, krok 2).
 *
 * Fronta uložených návrhů (`platby_faktury` ve stavu 'navrzeno'). Hledá je
 * synchronizace banky, import výpisu a tlačítko „Najít návrhy"
 * (lib/finance-navrhy-parovani.ts), appka sama nic nezaplatí: Potvrdit = párování (databáze ověří znovu
 * a přepočítá stav faktury), Odmítnout = dvojice se už nenavrhne. Návrh
 * v jiné měně se potvrzuje jako ruční úhrada v měně faktury s důvodem.
 *
 * Jen za celou firmu (faktury pobočku nemají) a jen s právem „Vidět
 * přijaté faktury". Tlačítka jen tomu, komu databáze potvrzení dovolí
 * (`smi_potvrdit_parovani`).
 *
 * Návrh, který mezitím přestal platit (faktura zaplacená jinak, odmítnutá,
 * archivovaná, duplicita; platbu pokrylo jiné párování nebo ruční úhrada),
 * se neukazuje — `navrhPlati` (lib/finance-parovani.ts). Potvrdit by ho
 * databáze stejně nepustila; kdyby se faktura vrátila, ukáže se zase.
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
  minHeight: '44px',
} as const

const NEJVIC_NAVRHU = 200

type Navrh = { id: string; transakce_id: string; faktura: string | null; castka_haleru: number; jistota: number | null; duvod: string | null; created_at: string }
type Pohyb = { id: string; datum: string; protistrana: string | null; protiucet: string | null; vs: string | null; castka_haleru: number; mena: string | null; smer: string }
type FakturaNavrhu = { id: string; dodavatel: string | null; cislo_faktury: string | null; variabilni_symbol: string | null; castka_haleru: number | null; mena: string | null; splatnost: string | null; stav: string | null; archivovano: boolean | null; duplicita: boolean | null }

function castka(haleru: number, mena: string | null): string {
  return jeVKorunach(mena) ? koruny(haleru) : `${(haleru / 100).toFixed(2).replace('.', ',')} ${(mena ?? '').trim().toUpperCase()}`
}

export default async function NavrhyParovani({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; prebytek?: string; potvrzeno?: string; odmitnuto?: string; nalezeno?: string; nedokonceno?: string }>
}) {
  const { rozsah } = await params
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'pobocka_bez_firmy') return <SdeleniPobockyBezFirmy rozsah={rozsah} />
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Návrhy párování vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }
  if (pobockaFinanci(pristup.scope)) {
    return (
      <Sdeleni nadpis="Návrhy párování jsou jen za celou firmu">
        Faktury pobočku nemají a potvrzené párování mění stav faktury celé firmy — otevřete pohled Celá firma.
      </Sdeleni>
    )
  }
  if (!canSee(pristup.ctx, 'faktury.read')) {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Návrhy párování vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }

  const { chyba, prebytek, potvrzeno, odmitnuto, nalezeno, nedokonceno } = await searchParams
  const supabase = await getServerSupabase()
  const pristupFaktury = await pristupKFakturam(tenantId)

  let obsah: ReactNode
  let smiHledat = false
  if (pristupFaktury.stav !== 'ok') {
    obsah = <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>{hlaskaBrany(pristupFaktury).text} Párování s fakturami teď nejde.</p>
  } else {
    const [navrhyRes, smiRes] = await Promise.all([
      supabase.from('platby_faktury')
        .select('id, transakce_id, faktura, castka_haleru, jistota, duvod, created_at')
        .eq('tenant_id', tenantId).eq('stav', 'navrzeno')
        .order('created_at', { ascending: false }).limit(NEJVIC_NAVRHU),
      supabase.rpc('smi_potvrdit_parovani', { p_tenant: tenantId }),
    ])
    const vsechnyNavrhy = (navrhyRes.data ?? []) as Navrh[]
    const smiPotvrdit = smiRes.data === true
    smiHledat = smiPotvrdit
    const idPohybu = [...new Set(vsechnyNavrhy.map((n) => n.transakce_id))]
    const idFaktur = [...new Set(vsechnyNavrhy.map((n) => n.faktura).filter((f): f is string => Boolean(f)))]
    const [pohybyRes, fakturyRes, parovaniRes, uhradyRes] = await Promise.all([
      idPohybu.length > 0
        ? supabase.from('transakce').select('id, datum, protistrana, protiucet, vs, castka_haleru, mena, smer').eq('tenant_id', tenantId).in('id', idPohybu)
        : Promise.resolve({ data: [], error: null }),
      idFaktur.length > 0
        ? fakturyFirmy(pristupFaktury, 'id, dodavatel, cislo_faktury, variabilni_symbol, castka_haleru, mena, splatnost, stav, archivovano, duplicita').in('id', idFaktur)
        : Promise.resolve({ data: [], error: null }),
      // Co z plateb už použilo jiné párování nebo ruční úhrada (návrh pak neplatí).
      idPohybu.length > 0
        ? supabase.from('platby_faktury').select('transakce_id, castka_haleru').eq('tenant_id', tenantId).eq('stav', 'potvrzeno').in('transakce_id', idPohybu)
        : Promise.resolve({ data: [], error: null }),
      idPohybu.length > 0
        ? supabase.from('faktury_rucni_uhrady').select('transakce_id').eq('tenant_id', tenantId).is('zruseno_kdy', null).in('transakce_id', idPohybu)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (navrhyRes.error || pohybyRes.error || fakturyRes.error || parovaniRes.error || uhradyRes.error) {
      obsah = <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>Návrhy se nepodařilo načíst — zkuste stránku obnovit.</p>
    } else {
      const pohyby = new Map(((pohybyRes.data ?? []) as Pohyb[]).map((p) => [p.id, p]))
      const faktury = new Map(((fakturyRes.data ?? []) as unknown as FakturaNavrhu[]).map((f) => [f.id, f]))
      const pouzito = new Map<string, number>()
      for (const a of (parovaniRes.data ?? []) as { transakce_id: string; castka_haleru: number }[]) {
        pouzito.set(a.transakce_id, (pouzito.get(a.transakce_id) ?? 0) + a.castka_haleru)
      }
      const rucneUhrazene = new Set(((uhradyRes.data ?? []) as { transakce_id: string | null }[]).map((u) => u.transakce_id))
      const navrhy = vsechnyNavrhy.filter((n) => {
        const f = n.faktura ? faktury.get(n.faktura) : undefined
        const p = pohyby.get(n.transakce_id)
        return navrhPlati(
          f ? { stav: f.stav, archivovano: f.archivovano === true, duplicita: f.duplicita === true } : undefined,
          p ? { castkaHaleru: p.castka_haleru, pouzitoHaleru: pouzito.get(p.id) ?? 0, rucneUhrazen: rucneUhrazene.has(p.id) } : undefined,
        )
      })
      const neplatnych = vsechnyNavrhy.length - navrhy.length
      const vetaNeplatnych = `${neplatnych} starších návrhů se neukazuje — faktura se mezitím zaplatila jinak, odmítla nebo archivovala, nebo platbu pokrylo jiné párování.`
      // Jedna karta na platbu, pod ní její návrhy (nejvýš 3 stejně dobré).
      const podlePohybu = new Map<string, Navrh[]>()
      for (const n of navrhy) podlePohybu.set(n.transakce_id, [...(podlePohybu.get(n.transakce_id) ?? []), n])

      obsah = navrhy.length === 0 ? (
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
          Žádný návrh nečeká. Appka hledá nové po každé synchronizaci banky a importu výpisu{smiPotvrdit ? ' — nebo hned tlačítkem Najít návrhy' : ''}.
          {neplatnych > 0 ? ` ${vetaNeplatnych}` : ''}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {neplatnych > 0 ? <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>{vetaNeplatnych}</p> : null}
          {[...podlePohybu.entries()].map(([pohybId, navrhyPohybu]) => {
            const p = pohyby.get(pohybId)
            return (
              <section key={pohybId} style={{ ...karta, display: 'grid', gap: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '15px' }}>
                    {p ? `${p.smer === 'prijem' ? 'Příjem' : 'Platba'} ${castka(p.castka_haleru, p.mena)} · ${p.datum}` : 'Platba'}
                  </h2>
                  {p ? (
                    <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                      {protistranaNeboUcet(p.protistrana, p.protiucet) || '—'}{p.vs ? ` · VS ${p.vs}` : ''}
                    </p>
                  ) : null}
                </div>
                {navrhyPohybu.map((n) => {
                  const f = n.faktura ? faktury.get(n.faktura) : undefined
                  const duvod = (n.duvod ?? '') as DuvodNavrhu
                  const jinaMena = duvod === 'jina_mena'
                  return (
                    <div key={n.id} style={{ display: 'grid', gap: '8px', borderTop: '1px solid var(--line-2)', paddingTop: '10px' }}>
                      <div style={{ fontSize: '13.5px' }}>
                        Faktura {f?.dodavatel || '—'}{f?.cislo_faktury ? ` · ${f.cislo_faktury}` : ''}
                        {f && f.castka_haleru !== null ? ` · ${castka(f.castka_haleru, f.mena)}` : ''}
                        {f?.splatnost ? ` · splatnost ${f.splatnost}` : ''}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {DUVODY_NAVRHU[duvod] ?? 'Návrh'} · jistota {Math.round(Number(n.jistota ?? 0) * 100)} %
                        {!jinaMena && p ? ` · spáruje se ${castka(n.castka_haleru, p.mena)}` : ''}
                      </div>
                      {smiPotvrdit ? (
                        jinaMena ? (
                          <form action={uhraditVJineMene} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input type="hidden" name="rozsah" value={rozsah} />
                            <input type="hidden" name="navrh_id" value={n.id} />
                            <input type="text" name="castka" required inputMode="decimal" aria-label={`Uhrazeno v měně faktury (${f?.mena ?? ''})`}
                              placeholder={`Částka v ${(f?.mena ?? '').trim().toUpperCase() || 'měně faktury'}`} style={{ ...pole, width: '160px' }} />
                            <input type="text" name="duvod" required minLength={5} maxLength={300} aria-label="Důvod ruční úhrady"
                              placeholder="Např. kurz banky ke dni platby" style={{ ...pole, minWidth: '220px' }} />
                            <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat úhradu</button>
                          </form>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <form action={potvrditNavrh}>
                              <input type="hidden" name="rozsah" value={rozsah} />
                              <input type="hidden" name="navrh_id" value={n.id} />
                              <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit</button>
                            </form>
                            <form action={odmitnoutNavrh}>
                              <input type="hidden" name="rozsah" value={rozsah} />
                              <input type="hidden" name="navrh_id" value={n.id} />
                              <button type="submit" className="ft-tl">Odmítnout</button>
                            </form>
                          </div>
                        )
                      ) : null}
                      {smiPotvrdit && jinaMena ? (
                        <form action={odmitnoutNavrh}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="navrh_id" value={n.id} />
                          <button type="submit" className="ft-tl ft-tl-male">Odmítnout návrh</button>
                        </form>
                      ) : null}
                    </div>
                  )
                })}
              </section>
            )
          })}
          {vsechnyNavrhy.length >= NEJVIC_NAVRHU ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>Ukázáno {NEJVIC_NAVRHU} nejnovějších návrhů — další se ukážou po vyřízení těchto.</p>
          ) : null}
          {!smiPotvrdit ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              Potvrzovat návrhy smí ten, kdo má „Správu financí“ i „Vidět přijaté faktury“ za celou firmu.
            </p>
          ) : null}
        </div>
      )
    }
  }

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance · Platby" popis="Platby, ke kterým appka našla pravděpodobnou fakturu. Sama je nezaplatí — rozhodnete vy.">
        Návrhy párování
      </Nadpis>
      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`/${rozsah}/finance/platby`} className="ft-tl ft-tl-male">← Platby</Link>
          <Link href={`/${rozsah}/finance/platby/bez-faktury`} className="ft-tl ft-tl-male">Platby bez faktury</Link>
          {smiHledat ? (
            <form action={najitNavrhyTed}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <button type="submit" className="ft-tl ft-tl-male">Najít návrhy</button>
            </form>
          ) : null}
        </div>
        {chyba ? <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {potvrzeno ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>Uloženo — stav faktury se přepočítal.</p> : null}
        {odmitnuto ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>Návrh odmítnut — tahle dvojice se už nenavrhne.</p> : null}
        {nalezeno !== undefined && /^\d+$/.test(nalezeno) ? (
          <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            {nalezeno === '0' ? 'Hledání doběhlo — nový návrh nepřibyl.' : `Hledání doběhlo — nových návrhů: ${nalezeno}.`}
            {nedokonceno ? ' Všechny platby se nestihly projít — zbytek appka projde příště (nebo klikněte znovu).' : ''}
          </p>
        ) : null}
        {prebytek ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>
            Spárováno — faktura je přeplacená o {koruny(Number(prebytek))}. Co se s přebytkem stane (jiná faktura, dobropis, vrácení), rozhodněte vy.
          </p>
        ) : null}
        {obsah}
      </div>
    </Navigace>
  )
}
