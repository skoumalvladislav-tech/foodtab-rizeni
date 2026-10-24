/**
 * Jiné platby — převod mezi tvarem v databázi (snake_case, jak ho vrací
 * PostgREST a jak ho čtou funkce `jine_platby_*`) a typy aplikace
 * (lib/jine-platby-typy.ts).
 *
 * Jediné místo, kde se jména sloupců píšou v TS. Funkce v migraci
 * `20261016100000_jine_platby.sql` čtou z `p_hlavicka` a `p_polozky`
 * PŘESNĚ tyhle klíče — co tu chybí, databáze nedostane, co je navíc,
 * ignoruje. Hlídá scripts/jine-platby.test.mjs.
 *
 * Čistá funkce bez importů za běhu.
 */

import type {
  HlavickaNavrhu,
  KontrolaPos,
  PolozkaNavrhu,
  VysledekKontrolySkladu,
  VysledekKontrolyTrzby,
  ZaznamJinePlatby,
} from './jine-platby-typy.ts'

/**
 * Sloupce záznamu bez kiosku — záložní čtení, dokud migrace
 * 20261022100000_jine_platby_kiosek není v databázi (po sloučení do main
 * se aplikace nasadí dřív než db push; bez zálohy by Finance → Jiné
 * platby spadly na 42703).
 */
export const SLOUPCE_ZAZNAMU_ZAKLAD =
  'id, tenant_id, branch_id, pripojeni_id, pos_provozovna, datum_prodeje, oznaceni, kontakt_id, mena, castka_haleru, castka_puvod, typ_dokladu, externi_ucet, pos_prodej_id, stav_kontroly, stav_trzby, stav_skladu, stav_faktury, faktura_cislo, faktura_zdroj, faktura_castka_haleru, stav_uhrady, uhrada_transakce_id, uhrada_castka_haleru, kontrola_trzby, kontrola_skladu, pokladna_trzby, pokladna_skladu, nedohledana_operace, upozorneni_dokladu, rozpoznani_id, verze, vytvoril, vytvoreno, zmeneno'

/** Sloupce, které přidal kiosek (zdroj záznamu, opis názvu zařízení). */
export const SLOUPCE_KIOSKU = 'zdroj, zarizeni_nazev'

/** Sloupce záznamu pro `select(...)` — jeden seznam pro obrazovku i testy. */
export const SLOUPCE_ZAZNAMU = `${SLOUPCE_ZAZNAMU_ZAKLAD}, ${SLOUPCE_KIOSKU}`

/**
 * Přečte záznam(y) se všemi sloupci; když databáze sloupce kiosku ještě
 * nezná (42703 / PGRST204 — migrace není nasazená), zopakuje dotaz bez
 * nich. Záznam pak vyjde jako z aplikace (`zDbZaznam`: zdroj „aplikace“).
 * Jiná chyba se vrací beze změny (hlásí se nahlas jako dřív).
 */
export async function cistSeZalohou<T, E extends { code?: string | null } | null>(
  dotaz: (sloupce: string) => PromiseLike<{ data: T; error: E }>,
): Promise<{ data: T; error: E }> {
  const prvni = await dotaz(SLOUPCE_ZAZNAMU)
  if (prvni.error?.code === '42703' || prvni.error?.code === 'PGRST204') return dotaz(SLOUPCE_ZAZNAMU_ZAKLAD)
  return prvni
}

export const SLOUPCE_POLOZKY =
  'id, poradi, nazev_puvodni, nazev, mnozstvi, jednotka, cena_jednotkova_haleru, cena_celkem_haleru, sazba_dph, jistota, zdroj, druh, pos_produkt_id, pos_produkt_nazev, pos_mnozstvi, mapovani, vyzaduje_kontrolu, duvod_kontroly'

type Radek = Record<string, unknown>

const text = (v: unknown): string | null => (typeof v === 'string' ? v : v === null || v === undefined ? null : String(v))
const cislo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * `numeric` chodí z PostgREST jako číslo (JSON). Pro množství chceme text
 * s tečkou bez plovoucí chyby — numeric(12,3) má nejvýš tři desetinná
 * místa, takže převod přes `toFixed(3)` a ořez nul je přesný.
 */
export function numericNaText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v.toFixed(3).replace(/\.?0+$/, '')
}

export function zDbZaznam(r: Radek): ZaznamJinePlatby {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    branchId: String(r.branch_id),
    pripojeniId: text(r.pripojeni_id),
    posProvozovna: text(r.pos_provozovna),
    datumProdeje: text(r.datum_prodeje),
    oznaceni: text(r.oznaceni) ?? '',
    kontaktId: text(r.kontakt_id),
    mena: text(r.mena),
    castkaHaleru: cislo(r.castka_haleru),
    castkaPuvod: (text(r.castka_puvod) as ZaznamJinePlatby['castkaPuvod']) ?? null,
    typDokladu: (text(r.typ_dokladu) as ZaznamJinePlatby['typDokladu']) ?? 'nezjisteno',
    externiUcet: text(r.externi_ucet),
    posProdejId: text(r.pos_prodej_id),
    stavKontroly: r.stav_kontroly as ZaznamJinePlatby['stavKontroly'],
    stavTrzby: r.stav_trzby as ZaznamJinePlatby['stavTrzby'],
    stavSkladu: r.stav_skladu as ZaznamJinePlatby['stavSkladu'],
    stavFaktury: r.stav_faktury as ZaznamJinePlatby['stavFaktury'],
    fakturaCislo: text(r.faktura_cislo),
    fakturaZdroj: (text(r.faktura_zdroj) as ZaznamJinePlatby['fakturaZdroj']) ?? null,
    fakturaCastkaHaleru: cislo(r.faktura_castka_haleru),
    stavUhrady: r.stav_uhrady as ZaznamJinePlatby['stavUhrady'],
    uhradaTransakceId: text(r.uhrada_transakce_id),
    uhradaCastkaHaleru: cislo(r.uhrada_castka_haleru),
    kontrolaTrzby: (r.kontrola_trzby as KontrolaPos<VysledekKontrolyTrzby> | null) ?? null,
    kontrolaSkladu: (r.kontrola_skladu as KontrolaPos<VysledekKontrolySkladu> | null) ?? null,
    pokladnaTrzby: (r.pokladna_trzby as KontrolaPos<VysledekKontrolyTrzby> | null) ?? null,
    pokladnaSkladu: (r.pokladna_skladu as KontrolaPos<VysledekKontrolySkladu> | null) ?? null,
    nedohledanaOperace:
      r.nedohledana_operace && typeof r.nedohledana_operace === 'object' && !Array.isArray(r.nedohledana_operace)
        ? ((o: Record<string, unknown>) => ({ operace: text(o.operace), klic: text(o.klic), stav: text(o.stav), kdy: text(o.kdy) }))(
            r.nedohledana_operace as Record<string, unknown>,
          )
        : null,
    upozorneniDokladu: Array.isArray(r.upozorneni_dokladu) ? r.upozorneni_dokladu.filter((u): u is string => typeof u === 'string') : [],
    rozpoznaniId: text(r.rozpoznani_id),
    zdroj: r.zdroj === 'kiosek' ? 'kiosek' : 'aplikace',
    zarizeniNazev: text(r.zarizeni_nazev),
    verze: cislo(r.verze) ?? 0,
    vytvoril: text(r.vytvoril),
    vytvoreno: String(r.vytvoreno),
    zmeneno: String(r.zmeneno),
  }
}

export function zDbPolozka(r: Radek): PolozkaNavrhu {
  return {
    nazevPuvodni: text(r.nazev_puvodni) ?? '',
    nazev: text(r.nazev) ?? '',
    mnozstvi: numericNaText(r.mnozstvi),
    jednotka: text(r.jednotka),
    cenaJednotkovaHaleru: cislo(r.cena_jednotkova_haleru),
    cenaCelkemHaleru: cislo(r.cena_celkem_haleru),
    sazbaDph: numericNaText(r.sazba_dph),
    jistota: cislo(r.jistota),
    zdroj: (text(r.zdroj) as PolozkaNavrhu['zdroj']) ?? 'rucne',
    druh: (text(r.druh) as PolozkaNavrhu['druh']) ?? 'nezarazeno',
    posProduktId: text(r.pos_produkt_id),
    posProduktNazev: text(r.pos_produkt_nazev),
    posMnozstvi: numericNaText(r.pos_mnozstvi),
    mapovani: (text(r.mapovani) as PolozkaNavrhu['mapovani']) ?? 'nenamapovano',
    vyzadujeKontrolu: r.vyzaduje_kontrolu === true,
    duvodKontroly: text(r.duvod_kontroly) ?? '',
  }
}

/** `p_hlavicka` pro `jine_platby_ulozit_navrh`. */
export function doDbHlavicka(h: HlavickaNavrhu): Record<string, unknown> {
  return {
    datum_prodeje: h.datumProdeje,
    oznaceni: h.oznaceni,
    mena: h.mena,
    castka_haleru: h.castkaHaleru,
    castka_puvod: h.castkaPuvod,
    typ_dokladu: h.typDokladu,
    externi_ucet: h.externiUcet,
    kontakt_id: h.kontaktId,
    // Klíč jen od rozpoznání — bez něj databáze uložená upozornění ponechá.
    ...(h.upozorneniDokladu !== undefined ? { upozorneni_dokladu: h.upozorneniDokladu } : {}),
    ...(h.rozpoznaniId !== undefined ? { rozpoznani_id: h.rozpoznaniId } : {}),
  }
}

/** `p_polozky` pro `jine_platby_ulozit_navrh` — pořadí v poli = pořadí na dokladu. */
export function doDbPolozky(polozky: readonly PolozkaNavrhu[]): Record<string, unknown>[] {
  return polozky.map((p) => ({
    nazev_puvodni: p.nazevPuvodni,
    nazev: p.nazev,
    mnozstvi: p.mnozstvi,
    jednotka: p.jednotka,
    cena_jednotkova_haleru: p.cenaJednotkovaHaleru,
    cena_celkem_haleru: p.cenaCelkemHaleru,
    sazba_dph: p.sazbaDph,
    jistota: p.jistota,
    zdroj: p.zdroj,
    druh: p.druh,
    pos_produkt_id: p.posProduktId,
    pos_produkt_nazev: p.posProduktNazev,
    pos_mnozstvi: p.posMnozstvi,
    mapovani: p.mapovani,
    vyzaduje_kontrolu: p.vyzadujeKontrolu,
    duvod_kontroly: p.duvodKontroly,
  }))
}

/** Zachycení hlavičky ze záznamu (pro formulář a pro uložení beze změny). */
export function hlavickaZeZaznamu(z: ZaznamJinePlatby): HlavickaNavrhu {
  return {
    datumProdeje: z.datumProdeje,
    oznaceni: z.oznaceni,
    mena: z.mena,
    castkaHaleru: z.castkaHaleru,
    castkaPuvod: z.castkaPuvod,
    typDokladu: z.typDokladu,
    externiUcet: z.externiUcet,
    kontaktId: z.kontaktId,
  }
}
