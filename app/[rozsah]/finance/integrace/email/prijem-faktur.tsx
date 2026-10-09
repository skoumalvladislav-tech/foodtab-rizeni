import Link from 'next/link'
import type { ReactNode } from 'react'

import { getServerSupabase } from '@/lib/supabase/server'
import { AI_LIMIT_ZA_DEN, nacistNastaveni, VYCHOZI_OD, type NastaveniPrijmu } from '@/lib/faktury-prijem-typy'
import { nastavitPrijemFaktur, spustitPrijemTed, zapsatNavrhyAkce } from './akce'

/**
 * Panel „Příjem faktur" u jedné schránky (Integrace → E-mail).
 *
 * Čísla jdou uživatelským klientem — RLS na `faktury_prijem` je pustí jen
 * s `faktury.read`, takže kdo Faktury nevidí, nevidí ani evidenci příjmu.
 * Ovládání (`smiMenit`) navíc chce `integrace.manage` + `faktury.manage`;
 * akce si to ověří znovu samy.
 */

const SKUPINY: { klic: string; stavy: string[]; text: string; barva?: string }[] = [
  { klic: 'zapsano', stavy: ['zapsano'], text: 'Zapsáno do Faktur', barva: 'var(--dobre)' },
  { klic: 'existuje', stavy: ['existuje'], text: 'Už ve Fakturách (n8n nebo stejný doklad)' },
  { klic: 'ceka', stavy: ['ceka', 'chyba'], text: 'Čeká na zpracování' },
  { klic: 'navrh', stavy: ['navrh'], text: 'Návrh — čeká na potvrzení' },
  { klic: 'kontrola', stavy: ['vyzaduje_kontrolu'], text: 'Appka sama nepřečte — ruční kontrola', barva: 'var(--pozor)' },
  { klic: 'preskoceno', stavy: ['duplicita', 'neni_doklad'], text: 'Přeskočeno (kopie, nejde o doklad)' },
]

const tlacitkoRada = { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } as const
const drobne = { margin: 0, fontSize: '12.5px', color: 'var(--muted)' } as const

export type PolozkaKeKontrole = {
  id: string
  priloha_nazev: string
  odesilatel: string | null
  prijato_kdy: string | null
  duvod: string | null
  soubor_cesta: string | null
}

/** Návrh k potvrzení (režim náhled) — to, co by se zapsalo do Faktur. */
export type NavrhKPotvrzeni = {
  id: string
  priloha_nazev: string
  dodavatel: string | null
  cislo: string | null
  castka: number | null
  mena: string | null
  ucet: string | null
  stav: string | null
  poznamka: string | null
}

function navrhZRadku(r: { id: string; priloha_nazev: string; vysledek: unknown }): NavrhKPotvrzeni {
  const radek = ((r.vysledek ?? {}) as { radek?: Record<string, unknown> }).radek ?? {}
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  return {
    id: r.id,
    priloha_nazev: r.priloha_nazev,
    dodavatel: text(radek.supplier),
    cislo: text(radek.invoice_number),
    castka: typeof radek.amount === 'number' ? radek.amount : null,
    mena: text(radek.currency),
    ucet: text(radek.supplier_account),
    stav: text(radek.status),
    poznamka: text(radek.review_note),
  }
}

function Akce({ rozsah, id, akce, text, hlavni = false, children }: { rozsah: string; id: string; akce: string; text: string; hlavni?: boolean; children?: ReactNode }) {
  return (
    <form action={nastavitPrijemFaktur} style={tlacitkoRada}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="akce" value={akce} />
      {children}
      <button type="submit" className={hlavni ? 'ft-tl ft-tl-hlavni' : 'ft-tl'}>{text}</button>
    </form>
  )
}

export default async function PrijemFaktur({
  rozsah,
  pripojeniId,
  prijemSurovy,
  posledniBeh,
  smiMenit,
  databazeFakturOk,
  dnes,
}: {
  rozsah: string
  pripojeniId: string
  prijemSurovy: unknown
  posledniBeh: string | null
  smiMenit: boolean
  databazeFakturOk: boolean
  dnes: string
}) {
  const supabase = await getServerSupabase()

  const [pocty, keKontrole, navrhy] = await Promise.all([
    Promise.all(SKUPINY.map(async (s) => {
      const { count } = await supabase.from('faktury_prijem').select('id', { count: 'exact', head: true })
        .eq('pripojeni_id', pripojeniId).in('stav', s.stavy)
      return { klic: s.klic, pocet: count ?? 0 }
    })),
    supabase.from('faktury_prijem')
      .select('id, priloha_nazev, odesilatel, prijato_kdy, duvod, soubor_cesta')
      .eq('pripojeni_id', pripojeniId).eq('stav', 'vyzaduje_kontrolu')
      .order('prijato_kdy', { ascending: false, nullsFirst: false }).limit(10)
      .then(({ data }) => (data ?? []) as PolozkaKeKontrole[]),
    supabase.from('faktury_prijem')
      .select('id, priloha_nazev, vysledek')
      .eq('pripojeni_id', pripojeniId).eq('stav', 'navrh')
      .order('prijato_kdy', { ascending: true, nullsFirst: false }).limit(50)
      .then(({ data }) => ((data ?? []) as { id: string; priloha_nazev: string; vysledek: unknown }[]).map(navrhZRadku)),
  ])

  return (
    <PrijemFakturPanel
      rozsah={rozsah}
      pripojeniId={pripojeniId}
      nastaveni={nacistNastaveni(prijemSurovy)}
      pocty={Object.fromEntries(pocty.map((p) => [p.klic, p.pocet]))}
      keKontrole={keKontrole}
      navrhy={navrhy}
      posledniBeh={posledniBeh}
      smiMenit={smiMenit}
      databazeFakturOk={databazeFakturOk}
      dnes={dnes}
    />
  )
}

/** Jen vykreslení — data přes props (ať jde ukázat i bez databáze). */
export function PrijemFakturPanel({
  rozsah,
  pripojeniId,
  nastaveni,
  pocty: poctyPodleKlice,
  keKontrole,
  navrhy = [],
  posledniBeh,
  smiMenit,
  databazeFakturOk,
  dnes,
}: {
  rozsah: string
  pripojeniId: string
  nastaveni: NastaveniPrijmu
  pocty: Record<string, number>
  keKontrole: PolozkaKeKontrole[]
  navrhy?: NavrhKPotvrzeni[]
  posledniBeh: string | null
  smiMenit: boolean
  databazeFakturOk: boolean
  dnes: string
}) {
  const pocty = SKUPINY.map((s) => ({ ...s, pocet: poctyPodleKlice[s.klic] ?? 0 }))
  const navrhu = poctyPodleKlice.navrh ?? 0
  const nicNeni = pocty.every((p) => p.pocet === 0)

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '10px', display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '14px' }}>Příjem faktur</strong>
        <span style={{ fontSize: '12px', color: nastaveni.zapnuto ? 'var(--dobre)' : 'var(--muted)' }}>
          {nastaveni.zapnuto
            ? `Zapnuto · čte od ${new Date(`${nastaveni.od}T00:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'UTC' })} · ${nastaveni.ai.povoleno ? 'PDF a fotky čte AI' : 'jen ISDOC (bez AI)'} · ${nastaveni.rezim === 'automaticky' ? 'zapisuje rovnou' : 'náhled — zápis potvrzuje člověk'}`
            : 'Vypnuto'}
        </span>
      </div>

      {!databazeFakturOk ? (
        <p style={drobne}>
          Příjem faktur zapisuje do databáze Faktur — ta zatím pro tuhle firmu není napojená (viz modul Faktury).
        </p>
      ) : null}

      {nastaveni.zapnuto || !nicNeni ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 12px' }}>
          {pocty.map((p) => (
            <div key={p.klic} style={{ fontSize: '12.5px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: p.pocet > 0 && p.barva ? p.barva : 'inherit' }}>{p.pocet}</span>{' '}
              <span style={{ color: 'var(--muted)' }}>{p.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {nastaveni.zapnuto ? (
        <p style={drobne}>
          {posledniBeh ? `Naposledy prošla: ${new Date(posledniBeh).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })}. ` : 'Zatím neproběhla. '}
          Běží sama každých 30 minut. Nejisté doklady jdou do Faktur jako „Ke schválení“ nebo „Nutná ruční kontrola“ —{' '}
          <Link href={`/${rozsah}/finance/faktury/seznam?kontrola=1`} style={{ color: 'inherit', textDecoration: 'underline' }}>ukázat je ve Fakturách</Link>.
        </p>
      ) : null}

      {keKontrole.length > 0 ? (
        <details>
          <summary style={{ fontSize: '12.5px', cursor: 'pointer' }}>Přílohy, které appka sama nepřečte ({keKontrole.length === 10 ? '10 nejnovějších' : keKontrole.length})</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '12.5px' }}>
            {keKontrole.map((k) => (
              <li key={k.id}>
                {k.soubor_cesta ? <a href={`/api/faktury/priloha/${k.id}`} target="_blank" rel="noreferrer">{k.priloha_nazev}</a> : <span>{k.priloha_nazev}</span>}
                <span style={{ color: 'var(--muted)' }}>
                  {k.odesilatel ? ` · ${k.odesilatel}` : ''}
                  {k.prijato_kdy ? ` · ${new Date(k.prijato_kdy).toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })}` : ''}
                  {k.duvod ? ` — ${k.duvod}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {navrhy.length > 0 ? (
        <details open>
          <summary style={{ fontSize: '12.5px', cursor: 'pointer' }}>
            Návrhy k potvrzení ({navrhu > navrhy.length ? `${navrhy.length} z ${navrhu}` : navrhu}) — zkontrolujte hlavně účet
          </summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px', display: 'grid', gap: '6px', fontSize: '12.5px' }}>
            {navrhy.map((n) => (
              <li key={n.id}>
                <strong>{n.dodavatel ?? 'Neznámý dodavatel'}</strong>
                {n.cislo ? ` · ${n.cislo}` : ''}
                {n.castka !== null ? ` · ${n.castka.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${n.mena ?? ''}` : ''}
                {' · '}
                <a href={`/api/faktury/priloha/${n.id}`} target="_blank" rel="noreferrer">{n.priloha_nazev}</a>
                <div style={{ color: 'var(--muted)' }}>
                  Účet: {n.ucet ?? '—'}
                  {n.stav ? <> · půjde do „<span style={{ color: n.stav === 'Ke kontrole úhrady' ? 'inherit' : 'var(--pozor)' }}>{n.stav}</span>“</> : null}
                  {n.poznamka ? ` — ${n.poznamka}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {smiMenit && databazeFakturOk ? (
        nastaveni.zapnuto ? (
          <div style={{ display: 'grid', gap: '8px' }}>
            <div style={tlacitkoRada}>
              <form action={spustitPrijemTed}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="id" value={pripojeniId} />
                <button type="submit" className="ft-tl ft-tl-hlavni">Zpracovat teď</button>
              </form>
              {navrhu > 0 ? (
                <form action={zapsatNavrhyAkce}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={pripojeniId} />
                  <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat návrhy do Faktur ({navrhu})</button>
                </form>
              ) : null}
              {nastaveni.ai.povoleno
                ? <Akce rozsah={rozsah} id={pripojeniId} akce="ai_vypnout" text="Vypnout čtení přes AI" />
                : <Akce rozsah={rozsah} id={pripojeniId} akce="ai_zapnout" text="Povolit čtení PDF a fotek přes AI" />}
              {nastaveni.rezim === 'automaticky'
                ? <Akce rozsah={rozsah} id={pripojeniId} akce="rezim_nahled" text="Přepnout na náhled" />
                : <Akce rozsah={rozsah} id={pripojeniId} akce="rezim_automaticky" text="Zapisovat rovnou" />}
              <Akce rozsah={rozsah} id={pripojeniId} akce="vypnout" text="Vypnout příjem" />
            </div>
            <Akce rozsah={rozsah} id={pripojeniId} akce="od" text="Změnit">
              <label style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                Číst od{' '}
                <input type="date" name="od" required defaultValue={nastaveni.od} min="2000-01-01" max={dnes} style={{ padding: '4px 8px', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', color: 'inherit' }} />
              </label>
            </Akce>
            {!nastaveni.ai.povoleno ? (
              <p style={drobne}>Bez AI appka přečte jen faktury ve formátu ISDOC. PDF a fotky počkají — po povolení AI se zpracují samy.</p>
            ) : null}
          </div>
        ) : (
          <form action={nastavitPrijemFaktur} style={{ display: 'grid', gap: '8px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="id" value={pripojeniId} />
            <p style={drobne}>
              Appka bude schránku sama procházet a faktury z příloh zapisovat do Faktur — stejně jako dřív n8n.
              Schránku jen čte: nic nemaže, nepřesouvá ani neoznačuje jako přečtené. Co už zapsal n8n, nezapíše znovu.
            </p>
            <p style={drobne}>
              Faktury ve formátu ISDOC čte appka sama. <strong>PDF a fotky čte AI</strong> (model Claude od Anthropicu):
              posílá se jen příloha, předmět a odesílatel e-mailu — nic z mezd, docházky ani kontaktů. Nejvýš {AI_LIMIT_ZA_DEN} dokladů denně.
            </p>
            <label style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
              Číst od{' '}
              <input type="date" name="od" required defaultValue={VYCHOZI_OD} min="2000-01-01" max={dnes} style={{ padding: '4px 8px', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', color: 'inherit' }} />
            </label>
            <div style={tlacitkoRada}>
              <button type="submit" name="akce" value="zapnout_ai" className="ft-tl ft-tl-hlavni">Zapnout příjem faktur (PDF a fotky čte AI)</button>
              <button type="submit" name="akce" value="zapnout_bez_ai" className="ft-tl">Zapnout jen pro ISDOC (bez AI)</button>
            </div>
          </form>
        )
      ) : null}
    </div>
  )
}
