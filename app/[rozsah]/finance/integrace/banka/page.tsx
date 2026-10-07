import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import { jeNakonfigurovano as enableBankingNakonfigurovano, nactiBanky } from '@/lib/integrace-enablebanking'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import { pripojitFioUcet, synchronizovatTeto, odpojitBankovniUcet, zahajitPripojeniEnableBanking, upravitIntervalSynchronizace } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Integrace — Banka.
 *
 * Napojení bankovního účtu: Fio (plně funkční, token appka ověří živě
 * PŘED uložením) + Enable Banking (kostra — viz
 * docs/hlaseni/banka-poskytovatele-2026-10-04.md). Appka nikdy
 * nenahlásí „připojeno" bez ověřeného přístupu (zadání §2).
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
  pripojuje_se: { text: 'Připojuje se…', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
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
  poskytovatel: string
  stav: string
  posledni_sync_kdy: string | null
  posledni_sync_pocet_radku: number | null
  posledni_chyba: string | null
  platebni_ucet_id: string | null
  interval_synchronizace_minut: number | null
}
type Ucet = { id: string; nazev: string }
type Zustatek = { platebni_ucet_id: string; typ: string; castka_haleru: number; platny_k: string }

export default async function FinanceIntegraceBanka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; synchronizovano?: string; enablebanking?: string }>
}) {
  const { rozsah } = await params
  const { chyba, synchronizovano, enablebanking } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Banku vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'integrace.manage')
  const supabase = await getServerSupabase()

  const [pripojeniRes, uctyRes] = await Promise.all([
    supabase
      .from('integrace_pripojeni')
      .select('id, nazev, poskytovatel, stav, posledni_sync_kdy, posledni_sync_pocet_radku, posledni_chyba, platebni_ucet_id, interval_synchronizace_minut')
      .eq('tenant_id', tenantId)
      .eq('oblast', 'banka')
      .is('odpojeno_kdy', null)
      .order('nazev'),
    supabase.from('platebni_ucty').select('id, nazev').eq('tenant_id', tenantId).eq('aktivni', true).order('nazev'),
  ])

  const pripojeni = (pripojeniRes.data ?? []) as Pripojeni[]
  const ucty = (uctyRes.data ?? []) as Ucet[]
  const propojeneUctyId = new Set(pripojeni.map((p) => p.platebni_ucet_id).filter(Boolean))
  const volneUcty = ucty.filter((u) => !propojeneUctyId.has(u.id))

  let zustatky: Zustatek[] = []
  if (pripojeni.length > 0) {
    const { data } = await supabase
      .from('bankovni_zustatky')
      .select('platebni_ucet_id, typ, castka_haleru, platny_k')
      .in('platebni_ucet_id', pripojeni.map((p) => p.platebni_ucet_id).filter((x): x is string => Boolean(x)))
      .order('platny_k', { ascending: false })
    zustatky = (data ?? []) as Zustatek[]
  }

  function posledniZustatek(ucetId: string | null, typ: string): Zustatek | null {
    if (!ucetId) return null
    return zustatky.find((z) => z.platebni_ucet_id === ucetId && z.typ === typ) ?? null
  }

  const nazevUctu = (id: string | null) => ucty.find((u) => u.id === id)?.nazev ?? '—'

  /*
    Seznam bank se natáhne jen když je appka nakonfigurovaná — appka ho
    NIKDY nezkouší bez klíčů (`nactiBanky` by stejně vrátila `chyba`,
    ale zbytečné volání navíc). Chyba se tu nehlásí nahlas (appka
    normálně ukáže formulář bez bank a nechá chybu na pokusu připojit),
    ale appka ji aspoň zaloguje, ať není tichá.
  */
  let banky: { nazev: string; maxSouhlasDnu: number | null }[] = []
  let chybaBank: string | null = null
  if (enableBankingNakonfigurovano()) {
    const vysledekBank = await nactiBanky()
    if (vysledekBank.stav === 'ok') banky = vysledekBank.banky
    else {
      chybaBank = vysledekBank.duvod
      console.error('nactiBanky selhalo', vysledekBank.duvod)
    }
  }

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Fio banka: token ověřený živě před uložením. Ostatní banky (KB/ČSOB/ČS/Raiffeisenbank) přes Enable Banking — appka přesměruje na souhlas banky."
        vpravo={<Link href={`/${rozsah}/finance/integrace`} className="ft-tl">← Zpět na integrace</Link>}
      >
        Banka
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {synchronizovano ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            Synchronizace hotová — {synchronizovano} {synchronizovano === '1' ? 'nový pohyb' : 'nových pohybů'}.
          </p>
        ) : null}
        {enablebanking === 'pripojeno' ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>Účet přes Enable Banking je připojený.</p>
        ) : null}

        {pripojeni.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádný bankovní účet.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {pripojeni.map((p) => {
              const knihovni = posledniZustatek(p.platebni_ucet_id, 'knihovni')
              return (
                <div key={p.id} style={{ ...karta, display: 'grid', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{p.nazev}</strong>
                      <Stitek stav={p.stav} />
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{nazevUctu(p.platebni_ucet_id)}</div>
                  </div>
                  <div style={{ fontSize: '13px' }}>
                    {knihovni ? (
                      <>
                        Zůstatek: <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{koruny(knihovni.castka_haleru)}</strong>
                        <span style={{ color: 'var(--muted)' }}> — platný k {new Date(knihovni.platny_k).toLocaleString('cs-CZ')}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>Zůstatek zatím neznámý — proveďte první synchronizaci.</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {p.posledni_sync_kdy
                      ? `Poslední synchronizace: ${new Date(p.posledni_sync_kdy).toLocaleString('cs-CZ')} (${p.posledni_sync_pocet_radku ?? 0} nových pohybů)`
                      : 'Ještě nesynchronizováno.'}
                    {p.posledni_chyba ? <span style={{ color: 'var(--bad)' }}> — {p.posledni_chyba}</span> : null}
                    <span>
                      {' '}· Vlastní odstup: {p.interval_synchronizace_minut ? `${p.interval_synchronizace_minut} min` : 'žádný (jen podle naplánované úlohy)'}
                    </span>
                  </div>
                  {smiPsat ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <form action={synchronizovatTeto}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="pripojeni_id" value={p.id} />
                        <button type="submit" className="ft-tl">Synchronizovat teď</button>
                      </form>
                      <form action={upravitIntervalSynchronizace} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={p.id} />
                        <input
                          type="number"
                          name="interval_synchronizace_minut"
                          min={1}
                          defaultValue={p.interval_synchronizace_minut ?? ''}
                          placeholder="min"
                          style={{ ...pole, width: '80px', minHeight: '36px' }}
                        />
                        <button type="submit" className="ft-tl">Uložit odstup</button>
                      </form>
                      <form action={odpojitBankovniUcet}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="ft-tl">Odpojit</button>
                      </form>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {smiPsat ? (
          <form action={pripojitFioUcet} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Připojit Fio účet</h2>
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              Token vygenerujte v internetovém bankovnictví Fio: Nastavení → API → „Sledování účtu” (ne platební příkazy).
              Appka ho před uložením ověří živým dotazem na Fio API.
            </p>

            {volneUcty.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Nejdřív založte platební účet (nebo uvolněte existující) na stránce{' '}
                <Link href={`/${rozsah}/finance/platby`} className="ft-tl">Platby</Link>.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <label>
                  <span style={popisek}>Platební účet *</span>
                  <select name="platebni_ucet_id" required style={pole}>
                    {volneUcty.map((u) => <option key={u.id} value={u.id}>{u.nazev}</option>)}
                  </select>
                </label>
                <label>
                  <span style={popisek}>Název (volitelné)</span>
                  <input type="text" name="nazev" placeholder="např. Fio — běžný účet" style={pole} />
                </label>
              </div>
            )}

            <label>
              <span style={popisek}>Token *</span>
              <input type="password" name="token" required autoComplete="off" style={pole} />
            </label>

            <label>
              <span style={popisek}>Vlastní odstup synchronizace (minuty, volitelné)</span>
              <input type="number" name="interval_synchronizace_minut" min={1} placeholder="prázdné = jen podle naplánované úlohy" style={pole} />
            </label>

            {volneUcty.length > 0 ? (
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Ověřit a připojit</button>
              </div>
            ) : null}
          </form>
        ) : null}

        <div style={{ ...karta, display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>Ostatní banky (KB, ČSOB, Česká spořitelna, Raiffeisenbank)</h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
            Appka sama není licencovaný poskytovatel platebních informačních služeb — jede přes
            zprostředkovatele Enable Banking. Jedno připojení pak odemkne všechny tyhle banky pro celou appku.
          </p>

          {enableBankingNakonfigurovano() ? (
            smiPsat ? (
              <form action={zahajitPripojeniEnableBanking} style={{ display: 'grid', gap: '12px' }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                {volneUcty.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                    Nejdřív založte platební účet (nebo uvolněte existující) na stránce{' '}
                    <Link href={`/${rozsah}/finance/platby`} className="ft-tl">Platby</Link>.
                  </p>
                ) : banky.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>
                    Seznam bank se nepodařilo natáhnout — zkuste stránku načíst znovu za chvíli.
                    {chybaBank ? <span style={{ display: 'block', marginTop: '4px', color: 'var(--muted)' }}>({chybaBank})</span> : null}
                  </p>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                      <label>
                        <span style={popisek}>Banka *</span>
                        <select name="aspsp_nazev" required style={pole}>
                          {banky.map((b) => (
                            <option key={b.nazev} value={b.nazev}>
                              {b.nazev}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span style={popisek}>Platební účet *</span>
                        <select name="platebni_ucet_id" required style={pole}>
                          {volneUcty.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nazev}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                      Appka vás přesměruje přímo do vybrané banky, kde souhlas potvrdíte stejně jako v
                      internetovém bankovnictví. Appka při tom nikdy neuvidí přihlašovací údaje k vaší bance.
                    </p>
                    <div>
                      <button type="submit" className="ft-tl ft-tl-hlavni">Připojit účet</button>
                    </div>
                  </>
                )}
              </form>
            ) : null
          ) : (
            <>
              <div style={{ display: 'grid', gap: '6px', fontSize: '13px', color: 'var(--muted)' }}>
                <div style={{ display: 'flex', gap: '8px' }}><span>1.</span><span>Vytvořte si zdarma účet na Enable Banking — bez smlouvy, stačí e-mail.</span></div>
                <div style={{ display: 'flex', gap: '8px' }}><span>2.</span><span>V kontrolním panelu vytvořte API aplikaci a stáhněte soukromý klíč.</span></div>
                <div style={{ display: 'flex', gap: '8px' }}><span>3.</span><span>Klíč zadejte do appky (ve Vercelu, Settings → Environment Variables, jako <code>ENABLEBANKING_APPLICATION_ID</code> a <code>ENABLEBANKING_PRIVATE_KEY</code>).</span></div>
              </div>
              <div>
                <a
                  href="https://enablebanking.com/sign-in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ft-tl ft-tl-hlavni"
                >
                  Vytvořit účet na Enable Banking →
                </a>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                Tenhle krok dělá FoodTab jednou za celou appku, ne každý podnik zvlášť — jakmile je hotový,
                KB/ČSOB/ČS/Raiffeisenbank půjdou připojit stejně snadno jako Fio výš.
              </p>
            </>
          )}
        </div>
      </div>
    </Navigace>
  )
}
