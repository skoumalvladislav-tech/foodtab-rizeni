import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getUser, hasAccess } from '@/lib/authz'
import { datumACasSRokemVPasmu, denVPasmu } from '@/lib/cas'
import { zaznamPatriRozsahu } from '@/lib/finance-evidence-pobocka'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { getCurrentTenantId } from '@/lib/firma'
import { rozpoznavaniJeNastavene } from '@/lib/jine-platby-ai'
import { haleruNaText } from '@/lib/jine-platby-castky'
import { hlavickaZeZaznamu, numericNaText, SLOUPCE_POLOZKY, SLOUPCE_ZAZNAMU, zDbPolozka, zDbZaznam } from '@/lib/jine-platby-db'
import { mozneDuplicity, type IdentitaZaznamu } from '@/lib/jine-platby-duplicity'
import { sestavitPodklady, type KontaktFaktury } from '@/lib/jine-platby-faktura'
import { zkontrolovatDoklad, type KontrolaDokladu } from '@/lib/jine-platby-kontrola'
import { navrhnoutMapovani } from '@/lib/jine-platby-mapovani'
import { zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import { dostupneAkce, krokyPruvodce, muzeSchvalitVydej } from '@/lib/jine-platby-stav'
import { DRUHY_BEZ_SKLADU, PRAVA_CTENI_JINYCH_PLATEB, type RozpoznanyDoklad, type StavKontroly } from '@/lib/jine-platby-typy'
import { posunoutDen, provozniDen } from '@/lib/pokladna-cas'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import Nadpis from '../../../../nadpis'
import { aliasyPripojeni, kalendarPobocky, katalogPripojeni } from './akce-zaklad'
import type { PolozkaEditoru } from './editor-navrhu'
import Kroky from './kroky'
import { coZkontrolovat, datumCesky, jednotkaCesky, jeUuid } from './logika'
import { metadataPokladny } from './nacteni'
import Originaly from './originaly'
import SekceKontrola from './sekce-kontrola'
import { SekceFaktura, SekceUhrada, type PlatbaBanky } from './sekce-faktura'
import { SekceHistorie, SekceZruseni, type UdalostHistorie } from './sekce-historie'
import SekceSklad, { type NavrhVydeje, type OperaceVydeje, type PolozkaVydeje } from './sekce-sklad'
import SekceTrzba, { type RadekTrzby } from './sekce-trzba'

export const dynamic = 'force-dynamic'
/** Rozpoznání dokladu přes AI (akce-ai.ts) běží ve funkci této stránky — model dostane nejvýš 100 s. */
export const maxDuration = 120

/**
 * Finance → Tržby → Jiné platby → detail záznamu s průvodcem (9 kroků).
 *
 * Návrh a důvody: docs/jine-platby-navrh.md. Stránka jen čte a kreslí;
 * zapisují serverové akce (../akce.ts, ../akce-pos.ts, ../akce-ai.ts)
 * a o všem rozhoduje databáze.
 *
 * ---------------------------------------------------------------------
 * PŘÍSTUP — první řádky, dřív než cokoli načte
 *
 * `zkusPristupJinymPlatbam` (ne zkusPristupFinanci: agendu používá i obsluha
 * bez finance.read) + `pobockaFinanci`. Záznam se čte uživatelským klientem
 * s `.eq('tenant_id')` — o pobočce rozhodne RLS — a na pobočce navíc musí
 * patřit pobočce rozsahu (`zaznamPatriRozsahu`), jinak 404. Layout Financí
 * stránku nezastaví (Next ji vyrenderuje vedle něj), proto to dělá sama.
 *
 * ---------------------------------------------------------------------
 * PRÁVA PRO TLAČÍTKA: na POBOČCE ZÁZNAMU
 *
 * `pristup.prava` platí v rozsahu adresy (na firmě „za celou firmu“).
 * Zapisovací funkce se ale ptá `has_access(tenant, právo, branch_id
 * záznamu)` — tady se proto ptáme na totéž, ať tlačítko neslibuje, co
 * databáze odmítne. Co nakreslit, říká `dostupneAkce` (zrcadlo pravidel
 * databáze); rozhoduje vždy databáze.
 *
 * ---------------------------------------------------------------------
 * BANKOVNÍ PLATBY A KONTAKTY: jen s finance.read ZA CELOU FIRMU
 *
 * RLS `transakce` i `kontakty` je za celou firmu, ne za pobočku — stejné
 * pravidlo jako zkusPristupFinanci na pobočce. Proto se platby, napárovaná
 * platba i odběratelé načítají jen při `hasAccess(tenantId, 'finance.read',
 * null)`; jinak věta HLASKA_BEZ_FINANCI_FIRMY a žádný výběr platby.
 */

/** Okamžik vykreslení — mimo komponentu, ať je vidět, že kreslení na něm závisí (čerstvost kontrol). */
function ted(): number {
  return Date.now()
}

export default async function DetailJinePlatby({ params }: { params: Promise<{ rozsah: string; zaznam: string }> }) {
  const { rozsah, zaznam: zaznamId } = await params
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  const pristup = await zkusPristupJinymPlatbam(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="K Jiným platbám nemáte přístup">Jiné platby vidí ten, kdo má na provozovně některé z jejich oprávnění nebo finanční přehled.</Sdeleni>
  }
  const pobocka = pobockaFinanci(pristup.scope)
  if (!jeUuid(zaznamId)) notFound()

  const supabase = await getServerSupabase()
  const { data: radek, error: chybaZaznamu } = await supabase
    .from('jine_platby')
    .select(`${SLOUPCE_ZAZNAMU}, faktura_podklady, vydej_externi_id, vydej_doklad, zruseni_duvod`)
    .eq('id', zaznamId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (chybaZaznamu) throw new DotazSelhal('záznam Jiných plateb', chybaZaznamu)
  const r = radek as Record<string, unknown> | null
  if (!r || !zaznamPatriRozsahu(pobocka, r as { branch_id: string | null })) notFound()
  const z = zDbZaznam(r)

  const tedMs = ted()
  const zakl = { zaznam: z.id, verze: z.verze, rozsah }

  const [pravaPole, financeFirmy, uzivatel, kal, soubory, polozkyRadky, rozpoznaniRadek, navrhRadek, operaceRadek, historieRadky, trzbyRadky] = await Promise.all([
    Promise.all(PRAVA_CTENI_JINYCH_PLATEB.map(async (p) => [p, await hasAccess(tenantId, p, z.branchId)] as const)),
    hasAccess(tenantId, 'finance.read', null),
    getUser(),
    kalendarPobocky(supabase, tenantId, z.branchId),
    supabase.from('jine_platby_soubory').select('id, poradi, mime, velikost, otisk').eq('zaznam_id', z.id).eq('tenant_id', tenantId).order('poradi'),
    supabase.from('jine_platby_polozky').select(SLOUPCE_POLOZKY).eq('zaznam_id', z.id).eq('tenant_id', tenantId).order('poradi'),
    supabase.from('jine_platby_rozpoznani').select('id, stav, vysledek, duvod, vytvoreno').eq('zaznam_id', z.id).eq('tenant_id', tenantId).order('vytvoreno', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('jine_platby_skladove_navrhy').select('id, stav, otisk, obsah, odeslal, odeslano, schvalil, schvaleno, zamitl, zamitnuto, duvod_zamitnuti').eq('zaznam_id', z.id).eq('tenant_id', tenantId)
      .order('odeslano', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('pos_operace').select('stav, pokusu, platnost_do, externi_id, externi_doklad, chyba, duvod, zahajeno, dokonceno').eq('zaznam_id', z.id).eq('tenant_id', tenantId)
      .eq('druh', 'vydej')
      .order('zahajeno', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('jine_platby_historie').select('id, kdy, kdo, udalost, detail').eq('zaznam_id', z.id).eq('tenant_id', tenantId).order('kdy', { ascending: false }).limit(50),
    supabase.from('ostatni_trzby').select('id, castka_haleru, mena, datum, zapocitat, stav, potvrdil, potvrzeno, storno_duvod, stornovano').eq('zaznam_id', z.id).eq('tenant_id', tenantId).order('potvrzeno', {
      ascending: false,
    }),
  ])
  for (const [popis, odpoved] of [
    ['soubory záznamu', soubory],
    ['položky záznamu', polozkyRadky],
    ['rozpoznání', rozpoznaniRadek],
    ['skladový návrh', navrhRadek],
    ['operace v pokladně', operaceRadek],
    ['historie záznamu', historieRadky],
    ['ostatní tržby záznamu', trzbyRadky],
  ] as const) {
    if (odpoved.error) throw new DotazSelhal(popis, odpoved.error)
  }

  const prava = new Set<string>(pravaPole.filter(([, ma]) => ma).map(([p]) => p))
  const zona = kal.pasmo
  const dnes = provozniDen(tedMs, kal.denZacina, kal.pasmo)
  const seznamSouboru = (soubory.data ?? []) as { id: string; poradi: number; mime: string; velikost: number; otisk: string }[]
  const radkyPolozek = (polozkyRadky.data ?? []) as unknown as Record<string, unknown>[]
  const polozky = radkyPolozek.map(zDbPolozka)
  const polozkySId = radkyPolozek.map((x) => ({ ...zDbPolozka(x), id: String(x.id) }))
  const maPokladnu = z.pripojeniId !== null
  const navrhRaw = navrhRadek.data as Record<string, unknown> | null
  const zivyNavrh = navrhRaw !== null && (navrhRaw.stav === 'ceka_na_schvaleni' || navrhRaw.stav === 'schvaleno')
  const operaceRaw = operaceRadek.data as Record<string, unknown> | null

  // Pokladna záznamu (netajné údaje přes jine_platby_pokladny — až TEĎ, po RLS a zaznamPatriRozsahu, viz ./nacteni.ts).
  // Katalog a aliasy se čtou po stránkách; nenačtený nebo moc velký katalog (strop stránek) stránku
  // neshodí — ukáže se chyba u katalogu, přiřazení se nenabídne a uložení návrhu ho odmítne taky.
  const [pokladna, nactenyKatalog, vydejNahled] = await Promise.all([
    z.pripojeniId ? metadataPokladny(supabase, z.pripojeniId, tenantId, z.branchId) : Promise.resolve(null),
    Promise.all([katalogPripojeni(supabase, tenantId, z.pripojeniId), aliasyPripojeni(supabase, tenantId, z.pripojeniId)]).then(
      ([k, a]) => ({ katalog: k, aliasy: a, chyba: null as string | null }),
      (e: unknown) => ({ katalog: [], aliasy: [], chyba: e instanceof Error ? e.message : 'Katalog pokladny se nepodařilo načíst.' }),
    ),
    z.pripojeniId ? supabase.rpc('jine_platby_sestavit_vydej', { p_zaznam: z.id }) : Promise.resolve(null),
  ])
  const { katalog, aliasy, chyba: chybaKatalogu } = nactenyKatalog

  const akce = dostupneAkce(z, prava, {
    maPokladnu,
    maZiveNavrhSkladu: zivyNavrh,
    stavOperace: typeof operaceRaw?.stav === 'string' ? operaceRaw.stav : null,
    tedMs,
    uzivatelId: uzivatel?.id ?? null,
    dohledaniUctu: pokladna?.dohledaniUctu === true,
  })
  const kroky = krokyPruvodce(z, { pocetSouboru: seznamSouboru.length, pocetPolozek: polozky.length, maPokladnu, maZiveNavrhSkladu: zivyNavrh })

  /* ---------- Kontrola dokladu ---------- */
  const rozpoznani = rozpoznaniRadek.data as { stav: string; vysledek: unknown; duvod: string | null; vytvoreno: string } | null
  let kontrolaRozpoznani: KontrolaDokladu | null = null
  if (rozpoznani?.stav === 'ok' && rozpoznani.vysledek) {
    try {
      kontrolaRozpoznani = zkontrolovatDoklad(rozpoznani.vysledek as RozpoznanyDoklad, { dnes })
    } catch {
      kontrolaRozpoznani = null
    }
  }
  // Co zkontrolovat a co z toho „Označit jako zkontrolované“ blokuje (nad ULOŽENÝMI položkami, jako databáze).
  const kontrolaNavrhu = coZkontrolovat(polozky, hlavickaZeZaznamu(z))

  const katalogZivy = katalog.filter((k) => !k.smazano)
  /** Jednotka prodeje pokladny podle produktu (česky) — pro panel skladu. */
  const jednotkyProduktu: Record<string, string> = Object.fromEntries(katalogZivy.map((k) => [k.externiId, jednotkaCesky(k.jednotka)]))
  const polozkyEditoru: PolozkaEditoru[] = polozkySId.map((p) => ({
    id: p.id,
    nazevPuvodni: p.nazevPuvodni,
    nazev: p.nazev,
    mnozstvi: p.mnozstvi ? p.mnozstvi.replace('.', ',') : '',
    jednotka: p.jednotka ?? '',
    cenaJ: haleruNaText(p.cenaJednotkovaHaleru),
    cenaC: haleruNaText(p.cenaCelkemHaleru),
    dph: p.sazbaDph ? p.sazbaDph.replace('.', ',') : '',
    druh: p.druh,
    produkt: p.posProduktId ?? '',
    posProduktNazev: p.posProduktNazev,
    posMnozstvi: p.posMnozstvi,
    mapovani: p.mapovani,
    zdroj: p.zdroj,
    jistota: p.jistota,
    vyzadujeKontrolu: p.vyzadujeKontrolu,
    duvodKontroly: p.duvodKontroly,
    kandidati:
      p.mapovani === 'overeno' || DRUHY_BEZ_SKLADU.includes(p.druh) || katalogZivy.length === 0
        ? []
        : navrhnoutMapovani(p, katalogZivy, aliasy).kandidati.map((k) => ({ externiId: k.produkt.externiId, nazev: k.produkt.nazev, skore: k.skore, proc: k.proc })),
  }))

  let katalogAktualizovan: string | null = null
  if (z.pripojeniId && katalog.length > 0) {
    const { data } = await supabase
      .from('pos_katalog')
      .select('aktualizovano')
      .eq('tenant_id', tenantId)
      .eq('pripojeni_id', z.pripojeniId)
      .order('aktualizovano', { ascending: false })
      .limit(1)
      .maybeSingle()
    katalogAktualizovan = (data as { aktualizovano: string } | null)?.aktualizovano ?? null
  }

  /* ---------- Odběratelé (kontakty patří celé firmě: jen s finance.read za firmu) ---------- */
  let kontakty: { id: string; nazev: string; ico: string | null; dic: string | null }[] | null = null
  if (financeFirmy && prava.has('jine_platby.faktura')) {
    const { data, error } = await supabase
      .from('kontakty')
      .select('id, nazev, ico, dic')
      .eq('tenant_id', tenantId)
      .eq('je_odberatel', true)
      .is('deleted_at', null)
      .order('nazev')
      .limit(500)
    kontakty = error ? null : ((data ?? []) as { id: string; nazev: string; ico: string | null; dic: string | null }[])
  }
  let kontaktFaktury: KontaktFaktury | null = kontakty?.find((k) => k.id === z.kontaktId) ?? null
  if (!kontaktFaktury && z.kontaktId && financeFirmy) {
    const { data } = await supabase.from('kontakty').select('id, nazev, ico, dic').eq('id', z.kontaktId).eq('tenant_id', tenantId).maybeSingle()
    kontaktFaktury = (data as KontaktFaktury | null) ?? null
  }
  const podklady = sestavitPodklady(z, polozky, kontaktFaktury)

  /* ---------- Úhrada (bankovní platby jen s finance.read za firmu) ---------- */
  let platby: PlatbaBanky[] | null = null
  let naparovana: PlatbaBanky | null = null
  const naPlatbu = (t: Record<string, unknown>): PlatbaBanky => ({
    id: String(t.id),
    datum: String(t.datum),
    castkaHaleru: Number(t.castka_haleru),
    mena: String(t.mena),
    protistrana: String(t.protistrana ?? ''),
    vs: String(t.vs ?? ''),
  })
  if (financeFirmy) {
    if (prava.has('jine_platby.faktura') && z.mena) {
      const { data } = await supabase
        .from('transakce')
        .select('id, datum, castka_haleru, mena, protistrana, vs')
        .eq('tenant_id', tenantId)
        .eq('smer', 'prijem')
        .eq('mena', z.mena)
        .gte('datum', posunoutDen(dnes, -60))
        .order('datum', { ascending: false })
        .limit(100)
      platby = ((data ?? []) as Record<string, unknown>[]).map(naPlatbu)
    } else {
      platby = []
    }
    if (z.uhradaTransakceId) {
      const { data } = await supabase.from('transakce').select('id, datum, castka_haleru, mena, protistrana, vs').eq('id', z.uhradaTransakceId).eq('tenant_id', tenantId).maybeSingle()
      naparovana = data ? naPlatbu(data as Record<string, unknown>) : null
    }
  }

  /* ---------- Možné duplicity: tatáž pobočka ± 7 dní ---------- */
  const stred = z.datumProdeje ?? denVPasmu(z.vytvoreno, zona)
  const { data: ostatniRadky } = await supabase
    .from('jine_platby')
    .select('id, branch_id, pripojeni_id, datum_prodeje, castka_haleru, mena, externi_ucet, pos_prodej_id, stav_kontroly')
    .eq('tenant_id', tenantId)
    .eq('branch_id', z.branchId)
    .neq('id', z.id)
    .gte('datum_prodeje', posunoutDen(stred, -7))
    .lte('datum_prodeje', posunoutDen(stred, 7))
    .limit(200)
  const ostatni = (ostatniRadky ?? []) as Record<string, unknown>[]
  const otiskyOstatnich = new Map<string, string[]>()
  if (ostatni.length > 0) {
    const { data } = await supabase
      .from('jine_platby_soubory')
      .select('zaznam_id, otisk')
      .eq('tenant_id', tenantId)
      .in(
        'zaznam_id',
        ostatni.map((o) => String(o.id)),
      )
    for (const s of (data ?? []) as { zaznam_id: string; otisk: string }[]) otiskyOstatnich.set(s.zaznam_id, [...(otiskyOstatnich.get(s.zaznam_id) ?? []), s.otisk])
  }
  const identita = (o: Record<string, unknown>, otisky: string[]): IdentitaZaznamu => ({
    id: String(o.id),
    branchId: String(o.branch_id),
    pripojeniId: typeof o.pripojeni_id === 'string' ? o.pripojeni_id : null,
    datumProdeje: typeof o.datum_prodeje === 'string' ? o.datum_prodeje : null,
    castkaHaleru: typeof o.castka_haleru === 'number' ? o.castka_haleru : null,
    mena: typeof o.mena === 'string' ? o.mena : null,
    externiUcet: typeof o.externi_ucet === 'string' ? o.externi_ucet : null,
    posProdejId: typeof o.pos_prodej_id === 'string' ? o.pos_prodej_id : null,
    stavKontroly: o.stav_kontroly as StavKontroly,
    otisky,
  })
  const duplicity = mozneDuplicity(
    identita(r, seznamSouboru.map((s) => s.otisk)),
    ostatni.map((o) => identita(o, otiskyOstatnich.get(String(o.id)) ?? [])),
  ).map((d) => ({ ...d, odkaz: `/${rozsah}/finance/trzby/jine-platby/${d.zaznamId}` }))

  /* ---------- Sklad ---------- */
  const naPolozkyVydeje = (pole: unknown): PolozkaVydeje[] =>
    (Array.isArray(pole) ? pole : []).map((e) => {
      const o = e as Record<string, unknown>
      return {
        poradi: typeof o.poradi === 'number' ? o.poradi : null,
        posProduktId: String(o.pos_produkt_id ?? ''),
        nazev: String(o.nazev ?? ''),
        mnozstvi: numericNaText(o.mnozstvi) ?? '?',
      }
    })
  const nahledData = vydejNahled && !vydejNahled.error ? (vydejNahled.data as Record<string, unknown> | null) : null
  const nahled = nahledData
    ? {
        polozky: naPolozkyVydeje((nahledData.obsah as Record<string, unknown> | undefined)?.polozky),
        blokace: (Array.isArray(nahledData.blokace) ? nahledData.blokace : []).map((b) => {
          const o = b as Record<string, unknown>
          return { poradi: typeof o.poradi === 'number' ? o.poradi : null, nazev: typeof o.nazev === 'string' ? o.nazev : null, duvod: String(o.duvod ?? '') }
        }),
        polozek: Number(nahledData.polozek ?? 0),
      }
    : null
  const navrh: NavrhVydeje | null = navrhRaw
    ? {
        id: String(navrhRaw.id),
        stav: String(navrhRaw.stav),
        otisk: String(navrhRaw.otisk),
        polozky: naPolozkyVydeje((navrhRaw.obsah as Record<string, unknown> | undefined)?.polozky),
        odeslal: (navrhRaw.odeslal as string | null) ?? null,
        odeslano: String(navrhRaw.odeslano),
        schvalil: (navrhRaw.schvalil as string | null) ?? null,
        schvaleno: (navrhRaw.schvaleno as string | null) ?? null,
        zamitl: (navrhRaw.zamitl as string | null) ?? null,
        zamitnuto: (navrhRaw.zamitnuto as string | null) ?? null,
        duvodZamitnuti: (navrhRaw.duvod_zamitnuti as string | null) ?? null,
      }
    : null
  const operace: OperaceVydeje | null = operaceRaw
    ? {
        stav: String(operaceRaw.stav),
        pokusu: Number(operaceRaw.pokusu ?? 0),
        platnostDo: (operaceRaw.platnost_do as string | null) ?? null,
        externiId: (operaceRaw.externi_id as string | null) ?? null,
        externiDoklad: (operaceRaw.externi_doklad as string | null) ?? null,
        chyba: (operaceRaw.chyba as string | null) ?? null,
        duvod: (operaceRaw.duvod as string | null) ?? null,
        zahajeno: String(operaceRaw.zahajeno),
        dokonceno: (operaceRaw.dokonceno as string | null) ?? null,
      }
    : null
  const idProvozovny = z.posProvozovna ?? pokladna?.provozovny.find((o) => o.branchId === z.branchId)?.id ?? null
  const provozovna = pokladna?.provozovny.find((o) => o.id === idProvozovny)?.nazev ?? idProvozovny ?? 'provozovna přiřazená k pobočce'

  /* ---------- Jména lidí (RLS profiles: kolegové s aktivním členstvím) ---------- */
  const historie = ((historieRadky.data ?? []) as Record<string, unknown>[]).map(
    (h): UdalostHistorie => ({
      id: String(h.id),
      kdy: String(h.kdy),
      kdo: (h.kdo as string | null) ?? null,
      udalost: String(h.udalost),
      detail: (h.detail as Record<string, unknown> | null) ?? null,
    }),
  )
  const trzby = ((trzbyRadky.data ?? []) as Record<string, unknown>[]).map(
    (t): RadekTrzby => ({
      id: String(t.id),
      castkaHaleru: Number(t.castka_haleru),
      mena: String(t.mena),
      datum: String(t.datum),
      zapocitat: t.zapocitat === true,
      stav: t.stav === 'stornovana' ? 'stornovana' : 'platna',
      potvrdil: (t.potvrdil as string | null) ?? null,
      potvrzeno: String(t.potvrzeno),
      stornoDuvod: (t.storno_duvod as string | null) ?? null,
      stornovano: (t.stornovano as string | null) ?? null,
    }),
  )
  const idLidi = [
    z.vytvoril,
    z.kontrolaTrzby?.kdo,
    z.kontrolaSkladu?.kdo,
    navrh?.odeslal,
    navrh?.schvalil,
    navrh?.zamitl,
    ...historie.map((h) => h.kdo),
    ...trzby.map((t) => t.potvrdil),
  ].filter((v): v is string => typeof v === 'string' && jeUuid(v))
  const jmena: Record<string, string> = {}
  if (idLidi.length > 0) {
    const { data } = await supabase.from('profiles').select('user_id, full_name').in('user_id', [...new Set(idLidi)])
    for (const p of (data ?? []) as { user_id: string; full_name: string | null }[]) {
      const jmeno = String(p.full_name ?? '').trim()
      if (jmeno) jmena[p.user_id] = jmeno
    }
  }

  const nazevPobocky = pristup.ctx.branches.find((b) => b.id === z.branchId)?.name ?? 'provozovna'
  const titulek = z.oznaceni.trim() || `Záznam z ${datumCesky(z.datumProdeje) || datumCesky(denVPasmu(z.vytvoreno, zona))}`
  const zruseno = z.stavKontroly === 'zruseno'
  const zruseniDuvod = typeof r.zruseni_duvod === 'string' ? r.zruseni_duvod : null

  return (
    <>
      <Nadpis
        oci="Finance · Tržby · Jiné platby"
        popis={`${nazevPobocky} · založeno ${datumACasSRokemVPasmu(z.vytvoreno, zona)}${z.vytvoril && jmena[z.vytvoril] ? ` · ${jmena[z.vytvoril]}` : ''}`}
        vpravo={
          <Link href={`/${rozsah}/finance/trzby/jine-platby`} className="ft-tl ft-tl-vedlejsi">
            Zpět na Jiné platby
          </Link>
        }
      >
        {titulek}
      </Nadpis>

      <div style={{ padding: '0 16px 32px', display: 'grid', gap: '16px', minWidth: 0 }}>
        {zruseno ? (
          <p className="hlaska-vareni" style={{ margin: 0 }}>
            Záznam je zrušený{zruseniDuvod ? ` — důvod: ${zruseniDuvod}` : ''}. Nic se z něj nezapočítává a nejde měnit.
          </p>
        ) : null}

        <Kroky kroky={kroky} />

        {/* Dva sloupce (originály | údaje a kroky), na úzkém displeji pod sebou. Flex se zalomením místo
            gridu: pravý sloupec má dostat víc místa, a to auto-fit mřížka bez media query neumí. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'grid', gap: '16px' }}>
            <Originaly
              soubory={seznamSouboru}
              nahrani={{
                rozsah,
                tenantId,
                branchId: z.branchId,
                zaznamId: z.id,
                uzMa: seznamSouboru.length,
                smi: akce.has('nahrat') && !zruseno,
              }}
            />
          </div>
          <div style={{ flex: '2 1 460px', minWidth: 0, display: 'grid', gap: '16px' }}>
            <SekceKontrola
              zakl={zakl}
              z={z}
              akce={akce}
              smiUpravit={prava.has('jine_platby.upravit')}
              editor={{
                hlavicka: {
                  datum: z.datumProdeje ?? '',
                  oznaceni: z.oznaceni,
                  mena: z.mena ?? '',
                  castka: haleruNaText(z.castkaHaleru),
                  castkaPuvod: z.castkaPuvod,
                  typ: z.typDokladu,
                  externi: z.externiUcet ?? '',
                  kontaktId: z.kontaktId ?? '',
                },
                polozky: polozkyEditoru,
                katalog: katalogZivy.map((k) => ({ externiId: k.externiId, nazev: k.nazev, jednotka: jednotkaCesky(k.jednotka) || null, mira: k.mira })),
                kontakty: kontakty?.map((k) => ({ id: k.id, nazev: k.nazev, ico: k.ico })) ?? null,
              }}
              polozky={polozky}
              rozpoznani={rozpoznani ? { stav: rozpoznani.stav, vytvoreno: rozpoznani.vytvoreno, duvod: rozpoznani.duvod } : null}
              kontrolaRozpoznani={kontrolaRozpoznani}
              coZkontrolovat={kontrolaNavrhu.body}
              nesoulad={kontrolaNavrhu.nesoulad?.popis ?? null}
              ai={{ zapnuto: rozpoznavaniJeNastavene(), pocetSouboru: seznamSouboru.length }}
              katalog={maPokladnu ? { umi: pokladna?.katalog === true, pocet: katalogZivy.length, aktualizovano: katalogAktualizovan, chyba: chybaKatalogu } : null}
              zona={zona}
            />
            <SekceTrzba
              zakl={zakl}
              z={z}
              akce={akce}
              maPokladnu={maPokladnu}
              umiDohledani={pokladna?.dohledaniUctu === true}
              duplicity={duplicity}
              trzby={trzby}
              tedMs={tedMs}
              jmena={jmena}
              zona={zona}
            />
            <SekceSklad
              zakl={zakl}
              z={z}
              akce={akce}
              maPokladnu={maPokladnu}
              pokladna={pokladna}
              provozovna={provozovna}
              nahled={nahled}
              navrh={navrh}
              operace={operace}
              prevody={polozky.map((p, i) => ({
                poradi: i + 1,
                nazev: p.nazev,
                mnozstvi: p.mnozstvi,
                jednotka: p.jednotka,
                posProduktId: p.posProduktId,
                posMnozstvi: p.posMnozstvi,
                mapovani: p.mapovani,
              }))}
              originaly={seznamSouboru.map((s) => ({ id: s.id, poradi: s.poradi }))}
              duplicity={duplicity}
              jednotkyProduktu={jednotkyProduktu}
              muzeSchvalit={muzeSchvalitVydej(z, tedMs)}
              vydej={{
                externiId: typeof r.vydej_externi_id === 'string' ? r.vydej_externi_id : null,
                doklad: typeof r.vydej_doklad === 'string' ? r.vydej_doklad : null,
              }}
              tedMs={tedMs}
              jmena={jmena}
              zona={zona}
            />
            <SekceFaktura zakl={zakl} z={z} akce={akce} podklady={podklady} kontakty={kontakty?.map((k) => ({ id: k.id, nazev: k.nazev, ico: k.ico })) ?? null} />
            <SekceUhrada zakl={zakl} z={z} akce={akce} platby={platby} naparovana={naparovana} />
            <SekceHistorie udalosti={historie} jmena={jmena} zona={zona} mena={z.mena} />
            {akce.has('zrusit') ? <SekceZruseni zakl={zakl} /> : null}
          </div>
        </div>
      </div>
    </>
  )
}
