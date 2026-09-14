import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { KANALY } from '@/lib/marketing'
import {
  STAVY_ULOH,
  STAVY_ULOH_CEKAJICI,
  STAVY_ULOH_CHYBOVE,
  STAVY_ULOH_HOTOVE,
  popisStavuUlohy,
  radaKeStavu,
  spocitatUlohy,
} from '@/lib/marketing-text'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Publikované příspěvky a jejich stavy.
 *
 * Zadání: master prompt, obrazovka 12 z oddílu 22 a oddíl 16.
 *
 * ---------------------------------------------------------------------
 * UKAZUJE SE ÚLOHA, NE PŘÍSPĚVEK
 *
 * Příspěvek je jeden, ale ven jde na tolik sítí, kolik jich má
 * vybraných — a každá může dopadnout jinak: na Instagram to vyjde, na
 * Facebook spadne na vypršeném přístupu. Kdyby se tady kreslil
 * příspěvek, musel by mít jeden stav za obojí a ten by lhal.
 *
 * ---------------------------------------------------------------------
 * „ZVEŘEJNĚNO" SE BERE Z ÚLOHY, NE Z PŘÍSPĚVKU
 *
 * `marketing_prispevky.stav` je souhrn pro seznam. Co doopravdy odešlo,
 * ví jen úloha — tu mění fronta podle odpovědi poskytovatele. Obrazovka
 * proto čte `marketing_publikace_ulohy` a nikdy nic nepřepisuje.
 *
 * ---------------------------------------------------------------------
 * NANEČISTO SE NEPOČÍTÁ MEZI SKUTEČNÉ
 *
 * `zverejneno_nanecisto` je vlastní sloupec i vlastní stav. Na téhle
 * obrazovce má vlastní štítek a nesčítá se do „zveřejněno". Kdyby se
 * to smíchalo, ukázalo by číslo, které nikdy nikdo neviděl na síti —
 * a to je horší než neukázat nic.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

/*
  PŘIPOJENÉ TABULKY JSOU POLE, NE OBJEKT — PostgREST vrací vnořený
  vztah vždycky jako seznam, i když je to vazba jedna k jedné. Kdyby
  se to napsalo jako objekt, překlad projde a `p?.nazev` by v běhu
  bylo `undefined`.
*/
type Uloha = {
  id: string
  prispevek_id: string
  kanal: string
  format: string
  stav: string
  rezim: string
  poskytovatel: string
  planovano_na: string
  zverejneno_kdy: string | null
  pokusy: number
  max_pokusu: number
  dalsi_pokus_kdy: string | null
  posledni_chyba: string | null
  externi_id: string | null
  marketing_prispevky: { nazev: string; branch_id: string }[]
  marketing_publikace: { trvaly_odkaz: string | null; je_nanecisto: boolean }[]
}

/** Skupiny na obrazovce. Pořadí je pořadí důležitosti, ne abecedy. */
const SKUPINY = [
  {
    klic: 'chyby',
    nazev: 'Nepovedlo se',
    popis: 'Tohle na síť neodešlo. U každého je napsané, co s tím.',
    stavy: STAVY_ULOH_CHYBOVE,
  },
  {
    klic: 'rucne',
    nazev: 'Čeká na vás',
    popis: 'Připravené k ručnímu zveřejnění. Není to porucha — jen to musí někdo poslat sám.',
    stavy: ['k_rucnimu_zverejneni'],
  },
  {
    klic: 'ceka',
    nazev: 'Čeká ve frontě',
    popis: 'Naplánované, ještě neodešlo.',
    stavy: STAVY_ULOH_CEKAJICI,
  },
  {
    klic: 'hotovo',
    nazev: 'Odesláno',
    popis: 'Potvrzeno poskytovatelem. Zkoušky nanečisto jsou označené zvlášť.',
    stavy: STAVY_ULOH_HOTOVE,
  },
  {
    klic: 'zrusene',
    nazev: 'Zrušené',
    popis: 'Zrušilo se to samo, protože se po naplánování změnil obsah.',
    stavy: ['zruseno'],
  },
] as const

export default async function Publikovane({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ kanal?: string; stav?: string }>
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
        Publikované příspěvky vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  // Filtry se ověřují proti seznamům, které zná aplikace. Hodnota
  // z adresy je návrh uživatele, ne kousek dotazu.
  const kanal = KANALY.some((k) => k.klic === q.kanal) ? q.kanal! : ''
  const stav = q.stav && q.stav in STAVY_ULOH ? q.stav : ''

  let dotaz = supabase.from('marketing_publikace_ulohy')
    .select(`
      id, prispevek_id, kanal, format, stav, rezim, poskytovatel,
      planovano_na, zverejneno_kdy, pokusy, max_pokusu, dalsi_pokus_kdy,
      posledni_chyba, externi_id,
      marketing_prispevky ( nazev, branch_id ),
      marketing_publikace ( trvaly_odkaz, je_nanecisto )
    `)
    .eq('tenant_id', tenantId)
    .order('planovano_na', { ascending: false })
    .limit(200)

  if (kanal) dotaz = dotaz.eq('kanal', kanal)
  if (stav) dotaz = dotaz.eq('stav', stav)

  const odpoved = await dotaz

  if (tabulkaNeexistuje(odpoved.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Publikované</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Publikace zatím nejsou v databázi">
            Migrace marketingu ještě neproběhla. Nasazuje je Šéfík z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const ulohy = await seznam<Uloha>('publikační úlohy', Promise.resolve(odpoved))

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )

  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (branchId: string | undefined) =>
    (branchId ? zonaPobocky.get(branchId) : null) ?? zonaFirmy

  /*
    NANEČISTO SE POČÍTÁ ZVLÁŠŤ, a počítá se to v `lib/marketing-text.ts`.

    Sečíst `zverejneno` a `zverejneno_nanecisto` do jednoho čísla by
    znamenalo tvrdit, že na síti je něco, co tam nikdy nebylo. Stálo to
    tady a kontrola na to sahala grepem do zdrojáku — jenže taková
    kontrola na téhle záměně nespadla. Teď je to funkce, kterou jde
    zavolat (`scripts/marketing-publikovane.test.mjs`).
  */
  const pocty = spocitatUlohy(ulohy)

  const odkaz = (zmena: { kanal?: string; stav?: string }) => {
    const v = { kanal, stav, ...zmena }
    const p = new URLSearchParams()
    if (v.kanal) p.set('kanal', v.kanal)
    if (v.stav) p.set('stav', v.stav)
    const dotazovaciCast = p.toString()
    return `/${rozsah}/marketing/publikovane${dotazovaciCast ? `?${dotazovaciCast}` : ''}`
  }

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={
          ulohy.length === 0
            ? 'Zatím nic neodešlo'
            : `${pocty.skutecne} odesláno${pocty.nanecisto > 0 ? `, ${pocty.nanecisto} nanečisto` : ''}`
              + `${pocty.chyby > 0 ? `, ${pocty.chyby} se nepovedlo` : ''}`
              + `${pocty.rucne > 0 ? `, ${pocty.rucne} čeká na vás` : ''}`
        }
      >
        Publikované
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>

        <div style={{ ...karta, display: 'grid', gap: '10px' }}>
          <Radek
            nazev="Síť"
            polozky={KANALY.map((k) => ({ klic: k.klic, nazev: k.nazev }))}
            vybrane={kanal}
            odkazNa={(klic) => odkaz({ kanal: klic })}
          />
          <Radek
            nazev="Stav"
            polozky={Object.entries(STAVY_ULOH).map(([klic, nazev]) => ({ klic, nazev }))}
            vybrane={stav}
            odkazNa={(klic) => odkaz({ stav: klic })}
          />
        </div>

        {ulohy.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              {kanal || stav
                ? 'Tomuhle filtru nic neodpovídá.'
                : 'Zatím nic neodešlo ani nečeká. Až naplánujete první příspěvek, objeví se tady.'}
            </p>
          </div>
        ) : null}

        {SKUPINY.map((skupina) => {
          const vSkupine = ulohy.filter((u) => (skupina.stavy as readonly string[]).includes(u.stav))
          if (vSkupine.length === 0) return null

          return (
            <section key={skupina.klic} style={{ ...karta, display: 'grid', gap: '10px' }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>
                  {skupina.nazev} <span style={{ color: 'var(--muted)', fontWeight: 'normal' }}>({vSkupine.length})</span>
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{skupina.popis}</p>
              </div>

              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '10px' }}>
                {vSkupine.map((u) => {
                  const p = u.marketing_prispevky[0]
                  const pub = u.marketing_publikace[0]
                  const nanecisto = u.stav === 'zverejneno_nanecisto' || pub?.je_nanecisto === true
                  const rada = radaKeStavu(u.stav, u.rezim)
                  const kdy = u.zverejneno_kdy ?? u.planovano_na

                  return (
                    <li key={u.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                      <div style={{ fontSize: '14.5px' }}>
                        <Link href={`/${rozsah}/marketing/${u.prispevek_id}`}>
                          {p?.nazev ?? 'Příspěvek'}
                        </Link>
                        {nanecisto ? (
                          /*
                            ŠTÍTEK NANEČISTO JE POVINNÝ, NE OZDOBA. Bez
                            něj vypadá demo zápis stejně jako skutečné
                            zveřejnění — a to je přesně ta záměna, které
                            má celý modul zabránit.
                          */
                          <span style={{
                            marginLeft: '8px', fontSize: '11px', padding: '1px 6px',
                            borderRadius: '4px', border: '1px solid var(--mosaz)', color: 'var(--mosaz)',
                          }}>
                            NANEČISTO
                          </span>
                        ) : null}
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                        {KANALY.find((k) => k.klic === u.kanal)?.nazev ?? u.kanal}
                        {' · '}{nazevPobocky.get(p?.branch_id ?? '') ?? 'Provozovna'}
                        {' · '}{popisStavuUlohy(u.stav)}
                        {' · '}{datumACasVPasmu(kdy, zona(p?.branch_id))}
                        {u.pokusy > 1 ? ` · ${u.pokusy}. pokus z ${u.max_pokusu}` : ''}
                      </div>

                      {rada ? (
                        <p style={{ margin: '6px 0 0', fontSize: '13px' }}>{rada}</p>
                      ) : null}

                      {/*
                        PŮVODNÍ HLÁŠKA ZŮSTÁVÁ VIDĚT, i když je anglicky
                        a mluví o tokenech. Rada výš je pro člověka, tohle
                        je pro toho, kdo to půjde dohledat — bez ní se
                        nedá poznat, co se doopravdy stalo.
                      */}
                      {u.posledni_chyba ? (
                        <p style={{
                          margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          Hlášení: {u.posledni_chyba}
                        </p>
                      ) : null}

                      {/*
                        Externí id a odkaz jen u toho, co doopravdy
                        odešlo. U zkoušky nanečisto žádný odkaz není
                        a nabízet ho by znamenalo slíbit stránku, která
                        neexistuje.
                      */}
                      {!nanecisto && pub?.trvaly_odkaz ? (
                        <p style={{ margin: '4px 0 0', fontSize: '12px' }}>
                          <a href={pub.trvaly_odkaz} target="_blank" rel="noopener noreferrer">
                            Otevřít na {KANALY.find((k) => k.klic === u.kanal)?.nazev ?? u.kanal}
                          </a>
                        </p>
                      ) : null}

                      {!nanecisto && u.externi_id ? (
                        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                          Číslo u poskytovatele: {u.externi_id}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

/** Řádek filtru: „vše" a k tomu volby. */
function Radek({
  nazev,
  polozky,
  vybrane,
  odkazNa,
}: {
  nazev: string
  polozky: { klic: string; nazev: string }[]
  vybrane: string
  odkazNa: (klic: string) => string
}) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '12px', color: 'var(--muted)', minWidth: '38px' }}>{nazev}</span>
      <Link href={odkazNa('')} className={`ft-tl ft-tl-male${vybrane === '' ? ' ft-tl-hlavni' : ''}`}>Vše</Link>
      {polozky.map((p) => (
        <Link
          key={p.klic}
          href={odkazNa(p.klic)}
          className={`ft-tl ft-tl-male${vybrane === p.klic ? ' ft-tl-hlavni' : ''}`}
        >
          {p.nazev}
        </Link>
      ))}
    </div>
  )
}
