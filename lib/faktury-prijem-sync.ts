import 'server-only'

/**
 * Příjem faktur z e-mailu — napojení jádra (lib/faktury-prijem-jadro.ts)
 * na skutečnou databázi, úložiště, schránku a AI.
 *
 * Sdílí ho naplánovaná úloha i tlačítko „Spustit teď". Obojí běží jako
 * service_role (klientUlohy) — firma se proto bere VÝHRADNĚ z řádku
 * připojení, nikdy z požadavku, a do Faktur (od 18. 10. 2026
 * public.faktury v hlavní databázi) se zapisuje jen přes bránu
 * pristupKFakturamUlohy (Faktury firmy otevřené) a vždy s tenant_id firmy.
 *
 * Jádro (lib/faktury-prijem-jadro.ts) pracuje dál s tvarem řádku staré
 * databáze (RadekFaktury: supplier, amount v Kč…) — převod na české
 * sloupce a haléře je jen tady, na hranici s databází.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { klientUlohy } from './supabase/uloha.ts'
import { fakturyFirmy, pristupKFakturamUlohy, type PristupKFakturam } from './faktury-pristup.ts'
import { castkaNaHalere } from './faktury-prevod.ts'
import { rozsifrovat } from './integrace-klice.ts'
import { nactiDavkuZprav } from './faktury-prijem-imap.ts'
import { cteniAiJeNastavene, vytezitDokladAI } from './faktury-prijem-ai.ts'
import { nacistNastaveni, type RadekFaktury, type StavPrijmu } from './faktury-prijem-typy.ts'
import { STAV_CASTECNE, STAV_KE_KONTROLE, STAV_NEUHRAZENO, STAV_UHRAZENO } from './faktury-types.ts'
import {
  vratitDoFrontyJadro,
  zapsatNavrhyJadro,
  zpracovatPrijemJadro,
  type FakturyDb,
  type NovyZaznam,
  type Repozitar,
  type Sluzby,
  type Zaznam,
} from './faktury-prijem-jadro.ts'

export type VysledekPrijmu = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  duvod: string | null
  /** Kandidátních příloh nově zapsaných do evidence v tomhle běhu. */
  nalezeno: number
  zapsano: number
  existuje: number
  kontrola: number
  /** Kolik řádků ještě čeká na vytěžení (pro „zpracovávám dál"). */
  zbyva: number
  /** true = schránka je přečtená až do konce (kurzor na hlavě). */
  schrankaDoctena: boolean
  /**
   * true = AI je u schránky povolená, ale nejde použít (chybí klíč, neplatí,
   * došel kredit…). Doklady čekají; úloha to hlásí nahoru, ať se to někdo
   * dozví (9.–27. 10. 2026 to nevěděl nikdo).
   */
  aiNedostupne?: boolean
}

const KBELIK = 'faktury-prilohy'
const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10
/**
 * Ke zpracování: čekající a s chybou — i ty, které už vyčerpaly pokusy
 * (MAX_POKUSU): běh zabitý uprostřed posledního pokusu nechal řádek
 * v 'chyba' a dřív ho nevzal nikdo, ani ruční kontrola. Jádro je teď
 * hned na začátku pošle do ruční kontroly.
 */
const FRONTA = 'stav.eq.ceka,stav.eq.chyba'
/** Řádků na jeden dotaz — PostgREST víc než 1000 nevrátí (max-rows). */
const STRANKA = 1000

/** Původ adresy appky z NEXT_PUBLIC_APP_URL (jen schéma + host), jinak null. */
function zakladOdkazu(): string | null {
  const adresa = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!adresa) return null
  try {
    const url = new URL(adresa)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

const sluzby: Sluzby = {
  nactiDavku: nactiDavkuZprav,
  vytezitAI: vytezitDokladAI,
  aiNastaveno: cteniAiJeNastavene,
  ted: () => Date.now(),
  zakladOdkazu: zakladOdkazu(),
}

function hodit(error: { message: string } | null, co: string): void {
  if (error) throw new Error(`${co}: ${error.message}`)
}

/**
 * Regulární výraz pro číslo dokladu bez ohledu na mezery (a s `imatch` i na
 * velikost písmen): „FV 2026/0815" najde i „fv2026/0815" — stejně jako
 * porovnatSFakturou, které pak rozhodne. Každý znak je escapovaný, číslo
 * faktury nesmí nic znamenat jako vzor.
 */
export function vzorCisla(cislo: string): string | null {
  const znaky = Array.from(cislo.replace(/\s+/g, ''))
  if (znaky.length === 0 || znaky.length > 100) return null
  const esc = (z: string) => (/[\\^$.|?*+()[\]{}]/.test(z) ? `\\${z}` : z)
  return `^\\s*${znaky.map(esc).join('\\s*')}\\s*$`
}

const VZOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Kč z vytěžení (číslo) → celé haléře. Přesně, když to jde; jinak se
 * zaokrouhlí na haléř — stejně jako dřív sloupec numeric(12,2) ve staré
 * databázi (AI občas vrátí víc desetinných míst). Mimo rozsah → chyba.
 */
export function castkaPrijmuNaHalere(castka: number): number {
  const presne = castkaNaHalere(castka)
  if (presne !== null) return presne
  const zaokrouhlene = Math.round(castka * 100)
  if (!Number.isSafeInteger(zaokrouhlene) || Math.abs(zaokrouhlene) > 2147483647) {
    throw new Error('Faktury (zápis): částka mimo rozsah')
  }
  return zaokrouhlene
}

/** RadekFaktury (tvar jádra, staré názvy) → řádek public.faktury. */
export function naRadekFaktur(radek: RadekFaktury, tenantId: string): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    prijato_kdy: radek.received_at,
    email_odesilatel: radek.email_sender,
    email_predmet: radek.email_subject,
    dodavatel: radek.supplier,
    dodavatel_ico: radek.supplier_ico,
    cislo_faktury: radek.invoice_number,
    variabilni_symbol: radek.variable_symbol,
    castka_haleru: castkaPrijmuNaHalere(radek.amount),
    mena: radek.currency,
    datum_vystaveni: radek.issue_date,
    duzp: radek.duzp,
    splatnost: radek.due_date,
    ucet_dodavatele: radek.supplier_account,
    stav: radek.status,
    ke_kontrole: radek.needs_review,
    odkaz_pdf: radek.pdf_url,
    poznamka_kontroly: radek.review_note,
    vytah_textu: radek.document_text_excerpt,
    archivovano: radek.is_archived,
  }
}

function fakturyDb(p: Extract<PristupKFakturam, { stav: 'ok' }>): FakturyDb {
  return {
    async vOkne(odIso, doIso) {
      const { data, error } = await fakturyFirmy(p, 'id, email_sender:email_odesilatel, received_at:prijato_kdy, email_subject:email_predmet')
        .gte('prijato_kdy', odIso).lte('prijato_kdy', doIso).limit(200)
      hodit(error, 'Faktury (kontrola n8n)')
      return (data ?? []) as unknown as { id: string; email_sender: string | null; received_at: string; email_subject: string | null }[]
    },
    async podleCisla(cislo) {
      const vzor = vzorCisla(cislo)
      if (!vzor) return []
      const { data, error } = await fakturyFirmy(p, 'id, invoice_number:cislo_faktury, supplier_ico:dodavatel_ico, supplier:dodavatel, castka_haleru')
        .filter('cislo_faktury', 'imatch', vzor).limit(50)
      hodit(error, 'Faktury (kontrola duplicity)')
      // Jádro porovnává v Kč (porovnatSFakturou, tolerance 0,01).
      return ((data ?? []) as unknown as { id: string; invoice_number: string | null; supplier_ico: string | null; supplier: string | null; castka_haleru: number | null }[])
        .map(({ castka_haleru, ...r }) => ({ ...r, amount: typeof castka_haleru === 'number' ? castka_haleru / 100 : null }))
    },
    async uctyDodavatele(ico) {
      const { data, error } = await fakturyFirmy(p, 'ucet_dodavatele')
        .eq('dodavatel_ico', ico).in('stav', [STAV_KE_KONTROLE, STAV_UHRAZENO, STAV_CASTECNE, STAV_NEUHRAZENO])
        .not('duplicita', 'is', true).not('ucet_dodavatele', 'is', null).limit(1000)
      hodit(error, 'Faktury (účty dodavatele)')
      return ((data ?? []) as unknown as { ucet_dodavatele: string | null }[]).map((r) => r.ucet_dodavatele).filter((u): u is string => !!u)
    },
    async podleOdkazu(zaznamId) {
      if (!VZOR_UUID.test(zaznamId)) return null
      const { data, error } = await fakturyFirmy(p, 'id')
        .like('odkaz_pdf', `%/api/faktury/priloha/${zaznamId}`).limit(1)
      hodit(error, 'Faktury (kontrola dvojího zápisu)')
      const radek = (data ?? [])[0] as unknown as { id: string } | undefined
      return radek ? String(radek.id) : null
    },
    async vlozit(radek) {
      const { data, error } = await p.supabase.from('faktury').insert(naRadekFaktur(radek, p.tenantId)).select('id').single()
      hodit(error, 'Faktury (zápis)')
      return String((data as { id: string }).id)
    },
  }
}

function repozitar(supabase: SupabaseClient): Repozitar {
  return {
    async nactiPripojeni(id) {
      const { data } = await supabase.from('integrace_pripojeni')
        .select('id, tenant_id, externi_ucet, odpojeno_kdy')
        .eq('id', id).eq('oblast', 'email_dokladu').maybeSingle()
      if (!data) return null
      return {
        id: data.id,
        tenantId: data.tenant_id,
        odpojeno: data.odpojeno_kdy !== null,
        externiUcet: (data.externi_ucet ?? {}) as Record<string, unknown>,
      }
    },

    async nactiHeslo(id) {
      const { data } = await supabase.from('integrace_tajemstvi').select('sifra').eq('pripojeni_id', id).maybeSingle()
      if (!data?.sifra) return null
      try {
        return rozsifrovat(data.sifra).heslo || null
      } catch {
        return null
      }
    },

    async icoFirmy(tenantId) {
      const { data } = await supabase.from('tenants').select('ico').eq('id', tenantId).maybeSingle()
      return (data?.ico as string | null | undefined) ?? null
    },

    async fakturyProFirmu(tenantId) {
      const pristup = await pristupKFakturamUlohy(tenantId)
      return pristup.stav === 'ok' ? fakturyDb(pristup) : null
    },

    async oznacitPripojeni(id, zmena) {
      await supabase.from('integrace_pripojeni').update(zmena).eq('id', id)
    },

    async zamknout(tenantId, pripojeniId) {
      const { data: bezi } = await supabase.from('synchronizace_behy').select('id, zahajeno_kdy')
        .eq('integrace_pripojeni_id', pripojeniId).eq('stav', 'bezi').maybeSingle()
      if (bezi) {
        const minut = (Date.now() - new Date(bezi.zahajeno_kdy).getTime()) / 60_000
        if (minut < MINUT_NEZ_JE_BEH_ZASEKNUTY) return { ok: false, duvod: 'Příjem faktur z téhle schránky už běží.' }
        await supabase.from('synchronizace_behy')
          .update({ stav: 'chyba', dokonceno_kdy: new Date().toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', bezi.id)
      }
      const { data: beh, error } = await supabase.from('synchronizace_behy')
        .insert({ tenant_id: tenantId, integrace_pripojeni_id: pripojeniId, stav: 'bezi' }).select('id').single()
      if (error || !beh) return { ok: false, duvod: 'Příjem faktur z téhle schránky právě začal jinde.' }
      return { ok: true, behId: beh.id }
    },

    async odemknout(behId, vysledek) {
      await supabase.from('synchronizace_behy').update({
        stav: vysledek.ok ? 'hotovo' : 'chyba',
        dokonceno_kdy: new Date().toISOString(),
        pocet_novych_radku: vysledek.ok ? vysledek.pocet : null,
        chyba: vysledek.chyba,
      }).eq('id', behId)
    },

    async nactiKurzor(pripojeniId, slozka) {
      const { data } = await supabase.from('faktury_prijem_kurzory').select('uidvalidity, posledni_uid, od')
        .eq('pripojeni_id', pripojeniId).eq('slozka', slozka).maybeSingle()
      return data ? { uidvalidity: data.uidvalidity, posledniUid: Number(data.posledni_uid), od: String(data.od) } : null
    },

    async ulozitKurzor(k) {
      const { error } = await supabase.from('faktury_prijem_kurzory').upsert({
        pripojeni_id: k.pripojeniId,
        slozka: k.slozka,
        tenant_id: k.tenantId,
        uidvalidity: k.uidvalidity,
        posledni_uid: k.posledniUid,
        od: k.od,
        aktualizovano_kdy: new Date().toISOString(),
      }, { onConflict: 'pripojeni_id,slozka' })
      hodit(error, 'Kurzor schránky')
    },

    async smazatKurzor(pripojeniId, slozka) {
      const { error } = await supabase.from('faktury_prijem_kurzory').delete().eq('pripojeni_id', pripojeniId).eq('slozka', slozka)
      hodit(error, 'Kurzor schránky')
    },

    async vlozitZaznamy(radky: NovyZaznam[]) {
      for (let i = 0; i < radky.length; i += 200) {
        const { error } = await supabase.from('faktury_prijem')
          .upsert(radky.slice(i, i + 200), { onConflict: 'pripojeni_id,slozka,uidvalidity,uid,priloha_cast', ignoreDuplicates: true })
        hodit(error, 'Evidence příjmu')
      }
    },

    async najitPodleHashe(tenantId, hash) {
      const { data, error } = await supabase.from('faktury_prijem').select('id, faktura_id, stav, pripojeni_id')
        .eq('tenant_id', tenantId).eq('priloha_hash', hash).order('vytvoreno_kdy', { ascending: true }).limit(20)
      hodit(error, 'Evidence příjmu (otisk)')
      const radky = (data ?? []) as { id: string; faktura_id: string | null; stav: string; pripojeni_id: string }[]
      if (radky.length === 0) return []
      const { data: zive, error: chybaZivych } = await supabase.from('integrace_pripojeni').select('id')
        .in('id', [...new Set(radky.map((r) => r.pripojeni_id))]).is('odpojeno_kdy', null)
      hodit(chybaZivych, 'Evidence příjmu (schránky)')
      const ziveIds = new Set(((zive ?? []) as { id: string }[]).map((z) => z.id))
      return radky.map((r) => ({ id: r.id, fakturaId: r.faktura_id, stav: r.stav as StavPrijmu, pripojeniZive: ziveIds.has(r.pripojeni_id) }))
    },

    async nactiKeZpracovani(pripojeniId, limit, jenIsdoc) {
      let dotaz = supabase.from('faktury_prijem').select('*').eq('pripojeni_id', pripojeniId).or(FRONTA)
      if (jenIsdoc) dotaz = dotaz.eq('druh', 'isdoc')
      // NEJNOVĚJŠÍ E-MAIL PRVNÍ: nová faktura nesmí čekat za starým dočtem
      // (vrácené přílohy z „Přečíst znovu" mají vytvoreno_kdy z 9. 10. 2026
      // a bylo jich přes tisíc — staré pořadí by nové faktury odsunulo o dny).
      const { data, error } = await dotaz
        .order('prijato_kdy', { ascending: false, nullsFirst: false })
        .order('vytvoreno_kdy', { ascending: true })
        .order('uid', { ascending: true })
        .limit(limit)
      hodit(error, 'Fronta příjmu')
      return (data ?? []) as Zaznam[]
    },

    async nactiNavrhy(pripojeniId, limit) {
      const { data, error } = await supabase.from('faktury_prijem').select('*').eq('pripojeni_id', pripojeniId).eq('stav', 'navrh')
        .order('vytvoreno_kdy', { ascending: true }).limit(limit)
      hodit(error, 'Návrhy příjmu')
      return (data ?? []) as Zaznam[]
    },

    async najitParovePdf(z) {
      const { data } = await supabase.from('faktury_prijem').select('id')
        .eq('pripojeni_id', z.pripojeni_id).eq('slozka', z.slozka).eq('uidvalidity', z.uidvalidity).eq('uid', z.uid)
        .eq('stav', 'duplicita').eq('vysledek->>k_isdoc_casti', z.priloha_cast).limit(1).maybeSingle()
      return data ? { id: data.id } : null
    },

    async aktualizovatZaznam(id, zmena) {
      const { error } = await supabase.from('faktury_prijem').update(zmena).eq('id', id)
      hodit(error, 'Evidence příjmu')
    },

    async doplnitFakturu(id, fakturaId) {
      await supabase.from('faktury_prijem').update({ faktura_id: fakturaId }).eq('id', id)
    },

    async pocetCekajicich(pripojeniId) {
      const { count } = await supabase.from('faktury_prijem').select('id', { count: 'exact', head: true })
        .eq('pripojeni_id', pripojeniId).or(FRONTA)
      return count ?? 0
    },

    async nactiKeKontrole(pripojeniId) {
      // Po stránkách: PostgREST vrátí nejvýš 1000 řádků na dotaz (max-rows),
      // víc by tiše uřízl. Pořadí podle id, ať se stránky nepřekrývají.
      const radky: { id: string; duvod: string | null; soubor_cesta: string | null }[] = []
      for (let od = 0; ; od += STRANKA) {
        const { data, error } = await supabase.from('faktury_prijem').select('id, duvod, soubor_cesta')
          .eq('pripojeni_id', pripojeniId).eq('stav', 'vyzaduje_kontrolu')
          .order('id', { ascending: true }).range(od, od + STRANKA - 1)
        hodit(error, 'Evidence příjmu (ruční kontrola)')
        const stranka = (data ?? []) as { id: string; duvod: string | null; soubor_cesta: string | null }[]
        radky.push(...stranka)
        if (stranka.length < STRANKA) return radky
      }
    },

    async vratitDoFronty(pripojeniId, ids, duvod) {
      let vraceno = 0
      for (let i = 0; i < ids.length; i += 100) {
        // Jen stav, pokusy a důvod (= značka vrácení). Přečtený doklad
        // (vysledek, model) zůstává — po nepovedeném zápisu se jen znovu
        // zapíše, bez dalšího placeného čtení. zdroj_vytezeni a zpracovano_kdy
        // taky: denní strop AI počítá řádky, a vrácení ho nesmí vynulovat.
        const { data, error } = await supabase.from('faktury_prijem')
          .update({ stav: 'ceka', pokusu: 0, duvod })
          .eq('pripojeni_id', pripojeniId).eq('stav', 'vyzaduje_kontrolu').in('id', ids.slice(i, i + 100))
          .select('id')
        hodit(error, 'Evidence příjmu (vrácení do fronty)')
        vraceno += (data ?? []).length
      }
      return vraceno
    },

    async pocetAiDnes(tenantId, dnes) {
      const { count } = await supabase.from('faktury_prijem').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('zdroj_vytezeni', 'ai').gte('zpracovano_kdy', `${dnes}T00:00:00Z`)
      return count ?? 0
    },

    async nahratSoubor(cesta, data, mime) {
      const { error } = await supabase.storage.from(KBELIK).upload(cesta, data, { contentType: mime, upsert: false })
      // Cesta je otisk obsahu — „už existuje" znamená tentýž soubor, ne kolizi.
      if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`Úložiště příloh: ${error.message}`)
    },

    async stahnoutSoubor(cesta) {
      const { data, error } = await supabase.storage.from(KBELIK).download(cesta)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },
  }
}

function bezUlohy(): VysledekPrijmu {
  return { stav: 'chyba', duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.', nalezeno: 0, zapsano: 0, existuje: 0, kontrola: 0, zbyva: 0, schrankaDoctena: false }
}

export async function zpracovatPrijem(pripojeniId: string, moznosti: { konecMs: number }): Promise<VysledekPrijmu> {
  const supabase = klientUlohy()
  if (!supabase) return bezUlohy()
  return zpracovatPrijemJadro(repozitar(supabase), sluzby, pripojeniId, moznosti)
}

/** Aktivní e-mailová připojení se zapnutým příjmem dokladů. */
export async function vsechnaPripojeniSPrijmem(): Promise<{ id: string; tenantId: string }[]> {
  const supabase = klientUlohy()
  if (!supabase) return []
  const { data } = await supabase.from('integrace_pripojeni').select('id, tenant_id, externi_ucet')
    // Nejdéle nezpracovaná schránka první: velký dočet jedné schránky nesmí
    // ostatní odstavit (každé volání pak začne u jiné).
    .eq('oblast', 'email_dokladu').is('odpojeno_kdy', null)
    .order('posledni_sync_kdy', { ascending: true, nullsFirst: true }).order('vytvoreno_kdy', { ascending: true })
  return ((data ?? []) as { id: string; tenant_id: string; externi_ucet: Record<string, unknown> | null }[])
    .filter((p) => nacistNastaveni(p.externi_ucet?.prijem_dokladu).zapnuto)
    .map((p) => ({ id: p.id, tenantId: p.tenant_id }))
}

/**
 * „Přečíst znovu": vrátí do fronty přílohy, které skončily v ruční kontrole
 * jen kvůli chybě účtu AI nebo zápisu (lzeZkusitZnovu). Volá se až po
 * kontrole práv v akci (integrace.manage + faktury.manage za celou firmu);
 * firma z akce se tu ověří znovu proti řádku schránky.
 */
export async function vratitDoFronty(pripojeniId: string, tenantId: string): Promise<{ vraceno: number; duvod: string | null }> {
  const supabase = klientUlohy()
  if (!supabase) return { vraceno: 0, duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }
  try {
    return await vratitDoFrontyJadro(repozitar(supabase), pripojeniId, tenantId)
  } catch (e) {
    // Výpadek uprostřed: část dávek už mohla projít. Druhé kliknutí je
    // bezpečné — vrací jen to, co je pořád v ruční kontrole.
    return { vraceno: 0, duvod: `Vrácení do fronty se nepovedlo celé (${e instanceof Error ? e.message : String(e)}) — zkuste to znovu.` }
  }
}

/** Režim náhled: zapíše čekající návrhy (stav 'navrh') dané schránky do Faktur, nejdéle do `konecMs`. */
export async function zapsatNavrhy(
  pripojeniId: string,
  tenantId: string,
  konecMs: number,
): Promise<{ zapsano: number; chyby: number; zbyva: number; duvod: string | null }> {
  const supabase = klientUlohy()
  if (!supabase) return { zapsano: 0, chyby: 0, zbyva: 0, duvod: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' }
  return zapsatNavrhyJadro(repozitar(supabase), pripojeniId, tenantId, () => Date.now(), konecMs)
}
