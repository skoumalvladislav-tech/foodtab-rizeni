import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  NAZVY_KATEGORII,
  NAZVY_REZIMU,
  NAZVY_ZNACEK,
  znackaPoskytovatele,
} from '@/lib/marketing-katalog'
import { OTAZKY, doporucenaSestava, kolikKPripojeni, precistOdpovedi } from '@/lib/marketing-pruvodce'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Průvodce prvním spuštěním.
 *
 * Zadání: master prompt, oddíl 6 a obrazovka 2 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NESTAČILO ŘEŠIT OBRAZOVKOU NÁSTROJE
 *
 * Nástroje ukazují devět kategorií a v každé pár možností. Kdo
 * marketing zapíná poprvé, na ně kouká a neví, čím začít — a výsledek
 * je, že nezačne ničím.
 *
 * ---------------------------------------------------------------------
 * BEZ JAVASCRIPTU, JEDNÍM FORMULÁŘEM
 *
 * Otázky i výsledek jsou na jedné stránce. Odpovědi jdou do adresy,
 * takže se dá krokovat tam a zpátky, obnovit stránku i poslat odkaz
 * kolegovi — a nepotřebuje to klientskou komponentu.
 *
 * Vícekrokový průvodce s vlastním stavem by uměl přesně totéž a byl by
 * to kus kódu navíc, který se nedá ověřit bez prohlížeče.
 *
 * ---------------------------------------------------------------------
 * NIC SE TU NEPŘIPOJUJE
 *
 * Průvodce doporučí. Připojení — s klíči, šifrováním a zkouškou
 * spojení — dělá obrazovka Nástroje. Dvě cesty k témuž by se rozešly.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

export default async function Zacatek({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { rozsah } = await params
  const q = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Průvodce vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  /*
    Odpovědi se ověřují proti seznamu možností, ne berou tak, jak
    přijdou. Hodnota z adresy je návrh uživatele.
  */
  const odpovedi = precistOdpovedi((klic) => {
    const v = q[klic]
    return typeof v === 'string' ? v : null
  })

  const ukazatVysledek = q.hotovo === '1'
  const sestava = doporucenaSestava(odpovedi)
  const kPripojeni = kolikKPripojeni(sestava)

  const supabase = await getServerSupabase()

  /*
    CO UŽ JE PŘIPOJENÉ. Doporučovat připojení něčeho, co už připojené
    je, vypadá jako by průvodce nevěděl, co se děje.
  */
  const pripojeni = await seznam<{ kategorie: string; poskytovatel: string; stav: string }>(
    'připojení',
    supabase.from('marketing_pripojeni')
      .select('kategorie, poskytovatel, stav')
      .eq('tenant_id', tenantId)
      .is('odpojeno_kdy', null),
  ).catch(() => [])

  const uzPripojeno = new Set(pripojeni.filter((p) => p.stav === 'pripojeno').map((p) => p.kategorie))

  /** Adresa průvodce s upravenou odpovědí; ostatní se nesou dál. */
  const odkaz = (zmena: Record<string, string>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(odpovedi)) p.set(k, v)
    for (const [k, v] of Object.entries(zmena)) {
      if (v === '') p.delete(k)
      else p.set(k, v)
    }
    return `/${rozsah}/marketing/zacatek?${p.toString()}`
  }

  return (
    <>
      <Nadpis oci="Marketing" popis="Čtyři otázky a z nich sestava, kterou si pak můžete změnit.">
        Začínáme
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '860px', display: 'grid', gap: '16px' }}>

        <div style={karta}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Marketing se dá používat i bez jediného připojeného nástroje — texty se pak
            píšou ručně a příspěvky vkládáte na síť sami. Tenhle průvodce jen ukáže,
            <strong> co by vám co ušetřilo</strong>, a nic nezapíná.
          </p>
        </div>

        {/* --- OTÁZKY ----------------------------------------------- */}

        {OTAZKY.map((o) => (
          <section key={o.klic} style={{ ...karta, display: 'grid', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '16px' }}>{o.otazka}</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {o.moznosti.map((m) => {
                const vybrane = odpovedi[o.klic] === m.klic
                return (
                  <Link
                    key={m.klic}
                    href={odkaz({ [o.klic]: m.klic })}
                    className={`ft-tl${vybrane ? ' ft-tl-hlavni' : ''}`}
                    style={{ display: 'block', maxWidth: '260px' }}
                  >
                    <span style={{ display: 'block' }}>{m.nazev}</span>
                    <span style={{ display: 'block', fontSize: '11px', opacity: 0.8 }}>{m.popis}</span>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}

        {!ukazatVysledek ? (
          <div>
            <Link href={odkaz({ hotovo: '1' })} className="ft-tl ft-tl-hlavni" style={{ fontSize: '16px', padding: '12px 20px' }}>
              Ukázat doporučenou sestavu
            </Link>
          </div>
        ) : null}

        {/* --- SESTAVA ---------------------------------------------- */}

        {ukazatVysledek ? (
          <section style={{ ...karta, display: 'grid', gap: '12px' }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Doporučená sestava</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {kPripojeni === 0
                  ? 'Podle odpovědí nepotřebujete připojit nic — marketing zvládnete ručně.'
                  : `Z devíti oblastí dávají pro vás smysl ${kPripojeni}. Zbytek se dá přidat kdykoli.`}
                {' '}
                <strong>Není to zámek</strong> — každou položku jde v Nástrojích vyměnit za jinou.
              </p>
            </div>

            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '12px' }}>
              {sestava.map((s) => {
                const znacka = s.poskytovatel ? znackaPoskytovatele(s.poskytovatel) : null
                const hotovo = uzPripojeno.has(s.kategorie)

                return (
                  <li key={s.kategorie} style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14.5px' }}>{NAZVY_KATEGORII[s.kategorie]}</strong>
                      {s.poskytovatel ? (
                        <span style={{ fontSize: '14px' }}>{s.poskytovatel.nazev}</span>
                      ) : (
                        <span style={{ fontSize: '13px', color: 'var(--muted)' }}>zatím nepotřebujete</span>
                      )}
                      {hotovo ? (
                        <span style={{
                          fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                          border: '1px solid var(--mosaz)', color: 'var(--mosaz)',
                        }}>
                          UŽ PŘIPOJENO
                        </span>
                      ) : null}
                      {znacka && !hotovo ? (
                        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {NAZVY_ZNACEK[znacka]}
                        </span>
                      ) : null}
                    </div>

                    {/*
                      DŮVOD JE POVINNÁ ČÁST, NE DOPLNĚK.

                      Zadání, oddíl 6: „Doporučení musí být transparentní
                      a nesmí tvrdit, že jedna placená služba je povinná."
                      Doporučení bez důvodu je reklama.
                    */}
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                      {s.duvod}
                    </p>

                    {s.poskytovatel ? (
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                        Režim: {NAZVY_REZIMU[s.rezim]}
                        {s.poskytovatel.platiZakaznik
                          ? ' · platíte přímo poskytovateli, Foodtab si k tomu nic nepřičítá'
                          : ''}
                        {' · '}{s.poskytovatel.uctovani}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <Link href={`/${rozsah}/marketing/nastroje`} className="ft-tl ft-tl-hlavni">
                Přejít na Nástroje a připojit
              </Link>
              <Link href={`/${rozsah}/marketing/znacka`} className="ft-tl">
                Nebo nejdřív nastavit Značku
              </Link>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
              Nic z toho není povinné. Bez připojených nástrojů modul funguje dál —
              jen víc práce zbude na vás.
            </p>
          </section>
        ) : null}
      </div>
    </>
  )
}
