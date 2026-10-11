import Link from 'next/link'

import { POKLADNY, najitPokladnu } from '@/lib/pokladna-poskytovatele'
import type { ExterniUcetPokladny, ProvozovnaUctu } from '@/lib/pokladna-prirazeni'
import Nadpis from '../../../nadpis'
import { odpojitPokladnu, pripojitPokladnu, synchronizovatPokladnuTed, ulozitPrirazeni, zahajitPrihlaseniDotykacka } from './akce'
import KlicPrijmu from './klic-prijmu'

export type Pripojeni = {
  id: string
  branch_id: string | null
  poskytovatel: string
  stav: string
  nazev: string
  externi_ucet: ExterniUcetPokladny | null
  posledni_sync_kdy: string | null
  posledni_sync_pocet_radku: number | null
  posledni_chyba: string | null
}

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
const drobne = { fontSize: '12.5px', color: 'var(--muted)' } as const

const NAZVY_STAVU: Record<string, { text: string; barva: string; bg: string }> = {
  nepripojeno: { text: 'Čeká na první data', barva: 'var(--muted)', bg: 'var(--sunken)' },
  pripojuje_se: { text: 'Připojuje se…', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
  pripojeno: { text: 'Připojeno', barva: 'var(--dobre)', bg: 'var(--dobre-bg)' },
  vyzaduje_pozornost: { text: 'Vyžaduje pozornost', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
  chyba: { text: 'Chyba', barva: 'var(--bad)', bg: 'var(--bad-bg)' },
}

function Stitek({ stav }: { stav: string }) {
  const s = NAZVY_STAVU[stav] ?? NAZVY_STAVU.nepripojeno
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: s.bg, color: s.barva }}>
      {s.text}
    </span>
  )
}

const kdy = (iso: string) => new Date(iso).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
const datum = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

/** Kolik historie už provozovna má — „kompletní", „načteno od …", nebo nic. */
function stavHistorie(o: ProvozovnaUctu, historieOd: string | undefined): string {
  if (!o.branch_id) return 'nestahuje se'
  if (!o.dohnano_od) return 'čeká na první stažení'
  if (historieOd && o.dohnano_od <= historieOd) return `historie od ${datum(historieOd)} kompletní`
  return `načteno od ${datum(o.dohnano_od)}${historieOd ? `, dotahuje se do ${datum(historieOd)}` : ''}`
}

/**
 * Obsah obrazovky bez dotazů — data přicházejí v props, ať jde
 * vykreslit i v dočasném náhledu (`app/nahled/**`) s ukázkovými daty.
 */
export default function ObsahPokladen({
  rozsah,
  chyba,
  ok,
  smiPsat,
  sifrovani,
  prihlaseniDotykacka,
  pobocky,
  pripojeni,
  historieVychozi,
}: {
  rozsah: string
  chyba?: string
  ok?: string
  smiPsat: boolean
  sifrovani: boolean
  prihlaseniDotykacka: boolean
  pobocky: { id: string; name: string }[]
  pripojeni: Pripojeni[]
  historieVychozi: string
}) {
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))

  const vyberHistorie = (
    <label>
      <span style={popisek}>Načíst historii od</span>
      <input type="date" name="historie_od" defaultValue={historieVychozi} style={pole} />
    </label>
  )

  return (
    <>
      <Nadpis
        oci="Finance · Integrace"
        popis="Vyberte pokladnu, vložte přístup a přiřaďte její provozovny k pobočkám. Appka pak sama stahuje denní prodeje po produktech."
        vpravo={<Link href={`/${rozsah}/finance/integrace`} className="ft-tl">← Zpět na integrace</Link>}
      >
        Pokladní systémy
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p role="alert" style={{ margin: 0, fontSize: '13.5px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {ok ? <p role="status" style={{ margin: 0, fontSize: '13.5px', color: 'var(--dobre)' }}>{ok}</p> : null}

        {/* ---------------- Připojené pokladny ---------------- */}
        {pripojeni.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím není připojená žádná pokladna.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {pripojeni.map((p) => {
              const popis = najitPokladnu(p.poskytovatel)
              const ucet = p.externi_ucet ?? {}
              const provozovny = ucet.provozovny ?? []
              const maPrirazene = provozovny.some((o) => o.branch_id)
              return (
                <div key={p.id} style={{ ...karta, display: 'grid', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{p.nazev || popis?.nazev || p.poskytovatel}</strong>
                    <Stitek stav={p.stav} />
                  </div>
                  <div style={drobne}>
                    {popis?.nazev ?? p.poskytovatel}
                    {ucet.cloud_id ? ` · Cloud ID ${ucet.cloud_id}` : ''}
                    {p.branch_id ? ` · pobočka ${nazevPobocky.get(p.branch_id) ?? '—'}` : ''}
                    {' · '}
                    {p.posledni_sync_kdy
                      ? `naposledy ${kdy(p.posledni_sync_kdy)} (${p.posledni_sync_pocet_radku ?? 0} řádků)`
                      : 'zatím nic nestaženo'}
                  </div>
                  {p.posledni_chyba ? <div style={{ fontSize: '12.5px', color: 'var(--pozor)' }}>{p.posledni_chyba}</div> : null}

                  {/* Přiřazení provozoven pokladny k pobočkám v appce */}
                  {popis?.zpusob === 'token' && provozovny.length > 0 ? (
                    smiPsat ? (
                      <form action={ulozitPrirazeni} style={{ display: 'grid', gap: '8px' }}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={p.id} />
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>Provozovny v pokladně → pobočky v appce</div>
                        {provozovny.map((o) => (
                          <label key={o.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(180px, 1.2fr)', gap: '10px', alignItems: 'center' }}>
                            <span style={{ fontSize: '13.5px' }}>
                              {o.nazev}
                              <span style={{ display: 'block', ...drobne }}>{stavHistorie(o, ucet.historie_od)}</span>
                            </span>
                            <select name={`pobocka_${o.id}`} defaultValue={o.branch_id ?? ''} style={pole}>
                              <option value="">— nestahovat —</option>
                              {pobocky.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </label>
                        ))}
                        <div style={drobne}>
                          Změna pobočky u provozovny smaže, co appka z té provozovny zapsala do původní pobočky, a stáhne to znovu pod novou.
                        </div>
                        <div>
                          <button type="submit" className={maPrirazene ? 'ft-tl' : 'ft-tl ft-tl-hlavni'}>Uložit přiřazení</button>
                        </div>
                      </form>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px' }}>
                        {provozovny.map((o) => (
                          <li key={o.id}>{o.nazev} → {o.branch_id ? nazevPobocky.get(o.branch_id) ?? '—' : 'nestahuje se'} <span style={drobne}>({stavHistorie(o, ucet.historie_od)})</span></li>
                        ))}
                      </ul>
                    )
                  ) : null}

                  {smiPsat ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'start' }}>
                      {popis?.zpusob === 'token' && maPrirazene ? (
                        <form action={synchronizovatPokladnuTed}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="ft-tl">Synchronizovat teď</button>
                        </form>
                      ) : null}
                      {popis?.zpusob === 'prijem' ? <KlicPrijmu rozsah={rozsah} id={p.id} pole={pole} /> : null}
                      <form action={odpojitPokladnu}>
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

        {/* ---------------- Připojit pokladnu ---------------- */}
        {smiPsat ? (
          <>
            <h2 style={{ margin: '8px 0 0', fontSize: '16px' }}>Připojit pokladnu</h2>
            {!sifrovani ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>
                Na serveru chybí šifrovací klíč (INTEGRACE_KLIC_SIFRY) — přístupy k pokladnám by nešly bezpečně uložit, proto je připojení vypnuté.
              </p>
            ) : null}
            {pobocky.length === 0 ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Nejdřív založte pobočku.</p> : null}

            {sifrovani && pobocky.length > 0
              ? POKLADNY.map((popis) => (
                  <section key={popis.klic} style={{ ...karta, display: 'grid', gap: '12px' }}>
                    <div>
                      <strong style={{ fontSize: '15px' }}>{popis.nazev}</strong>
                      <div style={{ ...drobne, marginTop: '4px' }}>{popis.popis}</div>
                    </div>
                    <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--muted)', display: 'grid', gap: '2px' }}>
                      {popis.navod.map((krok) => <li key={krok}>{krok}</li>)}
                    </ol>

                    {popis.klic === 'dotykacka' && prihlaseniDotykacka ? (
                      <form action={zahajitPrihlaseniDotykacka} style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', alignItems: 'end' }}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        {vyberHistorie}
                        <div>
                          <button type="submit" className="ft-tl ft-tl-hlavni">Přihlásit přes Dotykačku</button>
                        </div>
                      </form>
                    ) : null}

                    {popis.zpusob === 'token' ? (
                      <form action={pripojitPokladnu} style={{ display: 'grid', gap: '12px' }}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="pokladna" value={popis.klic} />
                        {popis.klic === 'dotykacka' && prihlaseniDotykacka ? <div style={drobne}>…nebo vložte přístup ručně:</div> : null}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                          {popis.pole.map((p) => (
                            <label key={p.klic}>
                              <span style={popisek}>{p.nazev} *</span>
                              <input
                                type={p.tajne ? 'password' : 'text'}
                                name={`pole_${p.klic}`}
                                required
                                autoComplete="off"
                                spellCheck={false}
                                style={pole}
                              />
                              <small style={{ display: 'block', marginTop: '4px', ...drobne }}>{p.napoveda}</small>
                            </label>
                          ))}
                          {vyberHistorie}
                        </div>
                        <div>
                          <button type="submit" className="ft-tl ft-tl-hlavni">Ověřit a připojit</button>
                        </div>
                        <div style={drobne}>Po ověření appka ukáže provozovny z pokladny a vy je přiřadíte k pobočkám.</div>
                      </form>
                    ) : (
                      <>
                        <KlicPrijmu rozsah={rozsah} pobocky={pobocky} pole={pole} />
                        <details style={{ fontSize: '13px' }}>
                          <summary style={{ cursor: 'pointer' }}>Jak data posílat</summary>
                          <pre style={{ margin: '8px 0 0', padding: '10px', background: 'var(--sunken)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '12px' }}>{`POST /api/pokladna/prodeje
Authorization: Bearer <klíč>
Content-Type: application/json

{
  "prodeje": [
    { "datum": "2026-10-10", "produkt": "Pilsner 0,5 l", "mnozstvi": 120, "trzba": 7800 },
    { "datum": "2026-10-10", "produkt": "Svíčková", "mnozstvi": 18, "trzba": 4140 }
  ]
}`}</pre>
                          <p style={{ margin: '8px 0 0', ...drobne }}>
                            Klíč patří jedné pobočce — prodeje se zapíšou k ní. Posílejte vždy celý provozní den; appka ho přepíše, nic nezdvojí.
                            „trzba“ je v korunách s DPH. Den bez prodejů (vše stornováno) pošlete jako {'"dny": ["2026-10-10"]'}.
                          </p>
                        </details>
                      </>
                    )}
                  </section>
                ))
              : null}
          </>
        ) : null}

        <p style={{ margin: 0, ...drobne }}>
          Pokladna bez API? Prodeje jdou nahrát i ze souboru:{' '}
          <Link href={`/${rozsah}/finance/integrace/prodeje`} style={{ color: 'inherit', textDecoration: 'underline' }}>Import prodejů (CSV)</Link>.
          Když má pobočka v jednom dni data z napojené pokladny i z CSV, foodcost počítá jen pokladnu.
        </p>
      </div>
    </>
  )
}
