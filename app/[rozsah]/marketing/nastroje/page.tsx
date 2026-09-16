import Link from 'next/link'
import { redirect } from 'next/navigation'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import {
  BEZ_PRIPOJENI,
  NAZVY_KATEGORII,
  NAZVY_REZIMU,
  NAZVY_ZNACEK,
  POPIS_REZIMU,
  PORADI_KATEGORII,
  doporuceny,
  najdiPoskytovatele,
  poskytovateleKategorie,
  potrebnaPole,
  znackaPoskytovatele,
  type Kategorie,
  type Poskytovatel,
  type Rezim,
} from '@/lib/marketing-katalog'
import { sifrovaniJeNastavene } from '@/lib/marketing-klice'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { odpojitNastroj, otestovatPripojeni, pripojitNastroj } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Integrace a nástroje.
 *
 * Zadání: master prompt v2.2, oddíl 3.1 („Zásadní obchodní požadavek:
 * individuální volba nástrojů zákazníkem") a oddíl 6 („První spuštění,
 * doporučení a individuální připojení nástrojů"), obrazovka 14
 * z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ JE TAHLE OBRAZOVKA PRVNÍ Z TĚCH, CO CHYBĚLY
 *
 * Databáze na volbu nástrojů stojí od 9. 9. (`marketing_pripojeni`,
 * `marketing_tajemstvi`), ale připojení se do té doby dalo založit
 * jedině ručně v Supabase. Každý další kus modulu tak stál na tom, že
 * to za zákazníka někdo naklikal potají.
 *
 * ---------------------------------------------------------------------
 * CO TAHLE OBRAZOVKA NESMÍ
 *
 * Předstírat funkční integraci. Nástroj bez odzkoušeného adaptéru se
 * ukáže — ať je vidět, proč si ho nejde vybrat — ale nedostane
 * tlačítko. Rozhoduje o tom `podporovany` v `lib/marketing-katalog.ts`,
 * a serverová akce se na to ptá znovu (pravidlo 4).
 *
 * ---------------------------------------------------------------------
 * ROZSAH: FIRMA, NEBO POBOČKA
 *
 * Připojení patří firmě (`branch_id is null`), nebo konkrétní pobočce.
 * Na pobočce se ukazují obě — pobočkové přebíjí firemní —, ale měnit
 * se dá jen to, které patří rozsahu, ve kterém člověk právě stojí.
 * Jinak by se z pobočky přepojil nástroj celé firmě.
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
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '14px',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const
const drobne = { margin: 0, fontSize: '13px', color: 'var(--muted)' } as const

const stitek = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  fontSize: '12px',
  border: '1px solid var(--line)',
} as const

type Pripojeni = {
  id: string
  branch_id: string | null
  poskytovatel: string
  kategorie: string
  rezim: string
  stav: string
  nazev: string
  externi_ucet: Record<string, unknown>
  posledni_test_kdy: string | null
  posledni_test_ok: boolean | null
  posledni_chyba: string | null
}

/** Hlášky ke stavům z `marketing_pripojeni.stav` — česky, jak žádá oddíl 6. */
const NAZVY_STAVU: Record<string, string> = {
  nepripojeno: 'Nepřipojeno',
  pripojuje_se: 'Připojuje se',
  pripojeno: 'Připojeno',
  vyzaduje_pozornost: 'Vyžaduje pozornost',
  chyba: 'Chyba',
  odpojeno: 'Odpojeno',
}

export default async function NastrojeStranka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ ulozeno?: string; odpojeno?: string; zkouska?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { ulozeno, odpojeno, zkouska, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  /*
    Čtou se firemní i pobočková připojení. Politika
    `marketing_pripojeni_select` pustí jen to, na co má člověk rozsah —
    tenhle dotaz je první linie, ne jediná (pravidlo 3).
  */
  const vsechna = await seznam<Pripojeni>(
    'připojené nástroje',
    supabase.from('marketing_pripojeni')
      .select('id, branch_id, poskytovatel, kategorie, rezim, stav, nazev, externi_ucet, posledni_test_kdy, posledni_test_ok, posledni_chyba')
      .eq('tenant_id', tenantId)
      .is('odpojeno_kdy', null)
      .order('branch_id', { nullsFirst: false }),
  ).catch(() => [] as Pripojeni[])

  const zivá = vsechna.filter((p) => p.branch_id === null || p.branch_id === branchId)

  const zony = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  ).catch(() => [] as { timezone: string | null }[])
  const zona = zony[0]?.timezone ?? ZONA_VYCHOZI

  const smiMenit = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'
  const kdeJsme = pristup.scope.branchName ?? 'celá firma'

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={
          branchId === null
            ? 'Nástroje připojené za celou firmu. Pobočka si je může přebít vlastními.'
            : `Nástroje pro ${kdeJsme}. Co tu není, platí z firemní úrovně.`
        }
      >
        Integrace a nástroje
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '860px', display: 'grid', gap: '16px' }}>
        {ulozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Připojeno: {ulozeno}.</p> : null}
        {odpojeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Odpojeno. Klíč byl smazán.</p> : null}
        {zkouska ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Zkouška prošla: {zkouska}</p> : null}
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <div style={{ ...karta, background: 'var(--bg)' }}>
          <p style={{ ...drobne, marginBottom: '6px' }}>
            Foodtab nástroje <strong>doporučuje</strong>, vybíráte si je vy. Co si
            nepřipojíte, modul nezastaví — jen se to bude dělat ručně.
          </p>
          <p style={drobne}>
            Placené nástroje si hradíte přímo u poskytovatele. Ceny se mění, proto
            je tady nedržíme — u každého nástroje je odkaz na jeho návod a ceník.
          </p>
        </div>

        {!sifrovaniJeNastavene() && smiMenit ? (
          <p className="hlaska-chyba">
            Na serveru chybí <code>MARKETING_KLIC_SIFRY</code>. Nástroje s vlastním
            klíčem se do té doby připojit nedají — klíč by se nedal bezpečně uložit.
          </p>
        ) : null}

        {PORADI_KATEGORII.map((kategorie) => (
          <KartaKategorie
            key={kategorie}
            kategorie={kategorie}
            rozsah={rozsah}
            branchId={branchId}
            kdeJsme={kdeJsme}
            zona={zona}
            smiMenit={smiMenit}
            pripojeni={zivá.filter((p) => vKategorii(p, kategorie))}
          />
        ))}

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}

/**
 * Patří připojení do téhle kategorie?
 *
 * Rozhoduje KATALOG, ne sloupec `kategorie` — jeden nástroj může
 * pokrývat víc schopností (n8n publikuje i automatizuje), ale v řádku
 * je zapsaná jen ta hlavní. Kdyby se to četlo ze sloupce, n8n by se
 * u automatizace tvářilo jako nepřipojené.
 */
function vKategorii(p: Pripojeni, kategorie: Kategorie): boolean {
  const z = najdiPoskytovatele(p.poskytovatel)
  return z ? z.kategorie.includes(kategorie) : p.kategorie === kategorie
}

function KartaKategorie({
  kategorie,
  rozsah,
  branchId,
  kdeJsme,
  zona,
  smiMenit,
  pripojeni,
}: {
  kategorie: Kategorie
  rozsah: string
  branchId: string | null
  kdeJsme: string
  zona: string
  smiMenit: boolean
  pripojeni: Pripojeni[]
}) {
  const nabidka = poskytovateleKategorie(kategorie)
  const dop = doporuceny(kategorie)

  /*
    Pobočkové připojení přebíjí firemní — stejné pravidlo jako
    u Značky. Dotaz je seřazený tak, aby pobočkové bylo první.
  */
  const aktivni = pripojeni[0] ?? null
  const spravujeSeJinde = aktivni !== null && aktivni.branch_id !== branchId

  return (
    <section style={{ ...karta, display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>{NAZVY_KATEGORII[kategorie]}</h2>
        <span style={stitek}>{aktivni ? NAZVY_STAVU[aktivni.stav] ?? aktivni.stav : 'Nepřipojeno'}</span>
      </div>

      {aktivni ? (
        <Pripojene
          p={aktivni}
          rozsah={rozsah}
          zona={zona}
          smiMenit={smiMenit && !spravujeSeJinde}
          spravujeSeJinde={spravujeSeJinde}
        />
      ) : (
        <p style={drobne}>{BEZ_PRIPOJENI[kategorie]}</p>
      )}

      {!aktivni && dop ? (
        <Nabidnout p={dop} rozsah={rozsah} kdeJsme={kdeJsme} branchId={branchId} smiMenit={smiMenit} />
      ) : null}

      {nabidka.length > (aktivni ? 0 : dop ? 1 : 0) ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '13px' }}>
            {aktivni ? 'Vybrat jiný nástroj' : 'Další podporované možnosti'}
          </summary>
          <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
            {nabidka
              .filter((p) => (aktivni ? p.klic !== aktivni.poskytovatel : p.klic !== dop?.klic))
              .map((p) => (
                <Nabidnout
                  key={p.klic}
                  p={p}
                  rozsah={rozsah}
                  kdeJsme={kdeJsme}
                  branchId={branchId}
                  smiMenit={smiMenit}
                />
              ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

/** Panel připojeného nástroje: stav, účet, poslední zkouška, tlačítka. */
function Pripojene({
  p,
  rozsah,
  zona,
  smiMenit,
  spravujeSeJinde,
}: {
  p: Pripojeni
  rozsah: string
  zona: string
  smiMenit: boolean
  spravujeSeJinde: boolean
}) {
  const ucet = typeof p.externi_ucet?.nazev === 'string' ? p.externi_ucet.nazev : null

  return (
    <div style={{ display: 'grid', gap: '8px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
      <p style={{ margin: 0, fontSize: '14px' }}>
        <strong>{p.nazev || p.poskytovatel}</strong>{' '}
        <span style={stitek}>{NAZVY_REZIMU[p.rezim as Rezim] ?? p.rezim}</span>{' '}
        <span style={stitek}>{p.branch_id === null ? 'celá firma' : 'tato provozovna'}</span>
      </p>

      <p style={drobne}>{POPIS_REZIMU[p.rezim as Rezim] ?? ''}</p>

      {ucet ? <p style={drobne}>Účet: {ucet}</p> : null}

      <p style={drobne}>
        {p.posledni_test_kdy
          ? `Poslední zkouška ${datumACasVPasmu(p.posledni_test_kdy, zona)} — ${p.posledni_test_ok ? 'prošla' : 'neprošla'}.`
          : 'Zkouška zatím neproběhla.'}
      </p>

      {p.posledni_chyba ? <p className="hlaska-chyba">{p.posledni_chyba}</p> : null}

      {spravujeSeJinde ? (
        <p style={drobne}>Připojeno za celou firmu. Mění se na firemní úrovni.</p>
      ) : smiMenit ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <form action={otestovatPripojeni}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="pripojeni" value={p.id} />
            <button type="submit" className="ft-tl">Vyzkoušet spojení</button>
          </form>
          <form action={odpojitNastroj}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="pripojeni" value={p.id} />
            <button type="submit" className="ft-tl">Odpojit</button>
          </form>
        </div>
      ) : (
        <p style={drobne}>Nástroje připojuje ten, kdo smí zveřejňovat.</p>
      )}
    </div>
  )
}

/**
 * Nabídka jednoho nástroje z katalogu.
 *
 * Nepodporovaný nástroj dostane štítek „Připravujeme" a vysvětlení —
 * ne tlačítko. Zadání, oddíl 3.1: „pouhá položka v katalogu nesmí
 * předstírat funkční integraci."
 */
function Nabidnout({
  p,
  rozsah,
  kdeJsme,
  branchId,
  smiMenit,
}: {
  p: Poskytovatel
  rozsah: string
  kdeJsme: string
  branchId: string | null
  smiMenit: boolean
}) {
  const znacka = znackaPoskytovatele(p)

  return (
    <div style={{ display: 'grid', gap: '6px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
      <p style={{ margin: 0, fontSize: '14px' }}>
        <strong>{p.nazev}</strong> <span style={stitek}>{NAZVY_ZNACEK[znacka]}</span>
      </p>

      <p style={drobne}>{p.kCemu}</p>
      <p style={drobne}>Přínos: {p.prinos}</p>
      <p style={drobne}>Omezení: {p.omezeni}</p>
      {p.umi.length > 0 ? <p style={drobne}>Umí: {p.umi.join(', ')}.</p> : null}
      {p.neumi.length > 0 ? <p style={drobne}>Neumí: {p.neumi.join(', ')}.</p> : null}
      <p style={drobne}>
        Nastavení: {p.slozitost === 'snadne' ? 'snadné' : p.slozitost === 'stredni' ? 'střední' : 'náročné'}.
        {' '}Účtování: {p.uctovani}{' '}
        {p.platiZakaznik ? 'Platíte přímo poskytovateli.' : 'Nic neplatíte zvlášť.'}
      </p>

      {p.navod ? (
        <p style={drobne}>
          Návod: <a href={p.navod} target="_blank" rel="noreferrer noopener">{p.navod}</a>
        </p>
      ) : null}

      {!p.podporovany ? (
        <p style={drobne}>
          Připojit zatím nejde — Foodtab k tomuhle nástroji nemá odzkoušený adaptér.
          Kdyby tu bylo tlačítko, spadlo by to až při odesílání hotového příspěvku.
        </p>
      ) : smiMenit ? (
        <form action={pripojitNastroj} style={{ display: 'grid', gap: '8px', marginTop: '4px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="poskytovatel" value={p.klic} />

          <label>
            <span style={popisek}>Režim připojení</span>
            <select name="rezim" defaultValue={p.rezimy[0]} style={pole}>
              {p.rezimy.map((r) => (
                <option key={r} value={r}>{NAZVY_REZIMU[r]} — {POPIS_REZIMU[r]}</option>
              ))}
            </select>
          </label>

          {/*
            Pole se kreslí podle zákaznického režimu. U ostatních se
            nezadává nic — a kdyby se přesto poslala, akce je zahodí:
            `potrebnaPole` je mimo zákaznický režim prázdné.
          */}
          {potrebnaPole(p.klic, 'zakaznicky').map((u) => (
            <label key={u.klic}>
              <span style={popisek}>{u.nazev}</span>
              <input
                name={`udaj_${u.klic}`}
                type={u.tajne ? 'password' : 'text'}
                autoComplete="off"
                style={pole}
                placeholder={u.napoveda}
              />
              <span style={{ ...drobne, display: 'block', marginTop: '4px' }}>{u.napoveda}</span>
            </label>
          ))}

          <p style={drobne}>
            Připojí se pro: <strong>{branchId === null ? 'celou firmu' : kdeJsme}</strong>.
            Před uložením se spojení vyzkouší; když zkouška neprojde, nic nevznikne.
          </p>

          <div>
            <button type="submit" className="ft-tl ft-tl-hlavni">Připojit {p.nazev}</button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
