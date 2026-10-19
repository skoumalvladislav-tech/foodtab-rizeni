/**
 * Jiné platby — provedení a obnova sledované operace v pokladně
 * (skladový výdej, korekce). Nezávislé na dodavateli: pokladnu zná jen
 * přes `PosProOperaci`, databázi přes `RepoOperaci`. Dotykačku tu nikdo
 * nezná.
 *
 * Proč tak opatrně: výdej, který se provede dvakrát, odečte sklad
 * dvakrát a nikdo si toho nevšimne až do inventury. Proto:
 *
 *   1. Zabrání v databázi (`zahajit`) PŘED odesláním. Druhý souběžný
 *      pokus dostane „obsazeno" a nic neodešle.
 *   2. Odpověď „přijato" od pokladny NESTAČÍ. Úspěch je teprve to, co
 *      jde v pokladně dohledat podle idempotenčního klíče.
 *   3. Timeout, výjimka nebo nejasná odpověď = `nejasny_vysledek`.
 *      Pokladna mohla požadavek provést, takže se NIKDY neodesílá znovu —
 *      jen se dohledává (`obnovitOperaci`).
 *   4. Jako „chyba" (smí se zkusit znovu NOVOU operací) se nejasný
 *      výsledek uzavře, až když platnost požadavku prokazatelně vypršela
 *      a pokladna ho pořád nezná — po platnosti už ho neprovede.
 *
 * Čisté funkce bez sítě a databáze — testuje
 * scripts/jine-platby-pos-operace.test.mjs s podvrženým repo i pokladnou.
 */

/** Stavy operace — musí sedět s CHECK `pos_operace.stav` v migraci (hlídá scripts/jine-platby.test.mjs). */
export const STAVY_OPERACE = [
  'pripraveno',
  'odesila_se',
  'uspech',
  'nejasny_vysledek',
  'chyba',
  'nepodporovano',
  'rucne_dolozeno',
  'zruseno',
] as const
export type StavOperace = (typeof STAVY_OPERACE)[number]

export type OperacePos = {
  id: string
  /** Idempotenční klíč — zároveň externí ID požadavku v pokladně, podle něj se dohledává. */
  klic: string
  stav: StavOperace
  pokusu: number
  /** Do kdy smí pokladna požadavek ještě provést (ISO). */
  platnostDo: string | null
  externiProvozovna: string
  polozky: { produktId: string; mnozstvi: string }[]
  poznamka: string
}

export type ZaverOperace =
  | { stav: 'uspech'; externiId: string; doklad: string | null; vysledek: Record<string, unknown> }
  | { stav: 'nejasny_vysledek'; duvod: string }
  | { stav: 'chyba'; duvod: string }
  | { stav: 'nepodporovano'; duvod: string }

export type RepoOperaci = {
  zahajit(opId: string, platnostDoIso: string): Promise<{ stav: 'ok'; op: OperacePos } | { stav: 'obsazeno' } | { stav: 'nelze'; duvod: string }>
  dokoncit(opId: string, zaver: ZaverOperace): Promise<void>
}

export type VysledekOdeslani = { stav: 'odeslano' } | { stav: 'odmitnuto'; duvod: string } | { stav: 'nejasne'; duvod: string }

export type VysledekDohledani =
  | { stav: 'nalezeno'; externiId: string; doklad: string | null; detail: Record<string, unknown> }
  | { stav: 'nenalezeno' }
  | { stav: 'chyba'; duvod: string }

export type PosProOperaci = {
  schopnost: 'api' | 'rucne' | 'nepodporovano'
  odeslat?(op: OperacePos): Promise<VysledekOdeslani>
  dohledat?(klic: string): Promise<VysledekDohledani>
}

/** Jak dlouho smí pokladna požadavek ještě provést (POS akce „validity"). */
export const PLATNOST_POZADAVKU_MS = 5 * 60_000
/** Rezerva po konci platnosti na rozdíl hodin a zpoždění zpracování v pokladně. */
export const REZERVA_PO_PLATNOSTI_MS = 2 * 60_000

const hlaska = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Účet s klíčem operace v pokladně je, ale výdej z něj (zatím) neplyne — nejasný výsledek s touhle větou. */
export const HLASKA_UCET_NEDOKONCENY = 'Účet v pokladně existuje, ale není uzavřený a zaplacený Odpisem — ověřte ho v pokladně'

/**
 * Výdej z dohledaného účtu proběhl, jen když je účet UZAVŘENÝ, ZAPLACENÝ
 * a je to ODPIS (N17): `detail.stav === 'uzavreny'`, `detail.zaplaceno
 * === true`, `detail.odpis === true` (dohledání plní detail z `UcetPos`).
 * Otevřený, nezaplacený nebo neodpisový účet s klíčem operace znamená,
 * že požadavek do pokladny došel, ale skončil napůl (POS akce vrátí
 * třeba kód 2003 — účet vznikl, platba Odpisem ne): sklad při
 * `stockDeductionMode = documentIssue` neodečetl a v pokladně visí
 * otevřený účet. Takový nález NENÍ úspěch.
 *
 *   'uspech'      — účet uzavřený, zaplacený a odpis, s neprázdným ID;
 *   'nedokonceny' — účet je, ale něco z toho chybí (i chybějící údaj);
 *   null          — nic nenalezeno (nebo „nalezeno" bez ID — nic nedokazuje).
 */
function uspechZDohledani(d: VysledekDohledani): { stav: 'uspech'; zaver: ZaverOperace } | { stav: 'nedokonceny' } | null {
  if (!d || d.stav !== 'nalezeno' || typeof d.externiId !== 'string' || d.externiId.trim() === '') return null
  const detail = d.detail ?? {}
  if (detail.stav === 'uzavreny' && detail.zaplaceno === true && detail.odpis === true) {
    return { stav: 'uspech', zaver: { stav: 'uspech', externiId: d.externiId, doklad: d.doklad ?? null, vysledek: detail } }
  }
  return { stav: 'nedokonceny' }
}

/**
 * Provede připravenou operaci: zabrat → odeslat → ověřit dohledáním → uložit závěr.
 *
 * Vrací závěr (uložený přes `repo.dokoncit`), nebo `obsazeno` / `nelze`
 * (nic se neodeslalo ani neuložilo). Když selže samotné `dokoncit`,
 * výjimka projde ven: operace zůstane v databázi „odesílá se" a dohledá
 * ji `obnovitOperaci` — výsledek se neztratí potichu.
 */
export async function provestOperaci(
  op: OperacePos,
  repo: RepoOperaci,
  pos: PosProOperaci,
  tedMs: number,
): Promise<ZaverOperace | { stav: 'obsazeno' } | { stav: 'nelze'; duvod: string }> {
  if (op.stav !== 'pripraveno') return { stav: 'nelze', duvod: `Operace není připravená k odeslání (stav ${op.stav})` }

  // Pokladna, která výdej přes API neumí: nic se neodesílá, návrh je podklad pro ruční zpracování.
  if (pos.schopnost !== 'api' || typeof pos.odeslat !== 'function' || typeof pos.dohledat !== 'function') {
    const zaver: ZaverOperace = {
      stav: 'nepodporovano',
      duvod:
        pos.schopnost === 'api'
          ? 'Pokladna neumí odeslání i dohledání požadavku — výdej zpracujte ručně'
          : 'Pokladna výdej přes API neumí — zpracujte ho v pokladně ručně a doložte',
    }
    await repo.dokoncit(op.id, zaver)
    return zaver
  }

  // 1. Zabrat (souběh): kdo nezabral, nic neodešle.
  const platnostDoIso = new Date(tedMs + PLATNOST_POZADAVKU_MS).toISOString()
  let zabrani: Awaited<ReturnType<RepoOperaci['zahajit']>>
  try {
    zabrani = await repo.zahajit(op.id, platnostDoIso)
  } catch (e) {
    return { stav: 'nelze', duvod: `Operaci se nepodařilo zabrat: ${hlaska(e)}` }
  }
  if (zabrani.stav !== 'ok') return zabrani
  const zabrana: OperacePos = { ...zabrani.op, platnostDo: zabrani.op.platnostDo ?? platnostDoIso }

  // 2. Odeslat — jednou. Cokoli jiného než jasné „ano" nebo jasné „ne" je nejasné.
  let zaver: ZaverOperace = { stav: 'nejasny_vysledek', duvod: 'Odpověď pokladny, které appka nerozumí — dohledá se' }
  let odeslani: VysledekOdeslani | null = null
  try {
    odeslani = (await pos.odeslat(zabrana)) ?? null
  } catch (e) {
    zaver = { stav: 'nejasny_vysledek', duvod: `Odeslání skončilo chybou nebo vypršel čas — pokladna požadavek mohla přijmout (${hlaska(e)})` }
  }

  if (odeslani) {
    if (odeslani.stav === 'odmitnuto') {
      zaver = { stav: 'chyba', duvod: `Pokladna požadavek odmítla: ${odeslani.duvod}` }
    } else if (odeslani.stav === 'odeslano') {
      // 3. Ověřit: „přijato" nestačí, úspěch je jen to, co pokladna zná.
      try {
        const d = await pos.dohledat(zabrana.klic)
        const posudek = uspechZDohledani(d)
        zaver =
          posudek?.stav === 'uspech'
            ? posudek.zaver
            : {
                stav: 'nejasny_vysledek',
                duvod:
                  posudek?.stav === 'nedokonceny'
                    ? HLASKA_UCET_NEDOKONCENY
                    : d && d.stav === 'chyba'
                      ? `Pokladna požadavek přijala, ale dohledání selhalo (${d.duvod}) — dohledá se znovu`
                      : 'Pokladna požadavek přijala, ale zatím ho nejde dohledat — může ho ještě zpracovávat',
              }
      } catch (e) {
        zaver = { stav: 'nejasny_vysledek', duvod: `Pokladna požadavek přijala, ale dohledání selhalo (${hlaska(e)}) — dohledá se znovu` }
      }
    } else if (odeslani.stav === 'nejasne') {
      zaver = { stav: 'nejasny_vysledek', duvod: `Nejasná odpověď pokladny: ${odeslani.duvod}` }
    }
  }

  // 4. Uložit závěr (výjimka projde ven — viz komentář funkce).
  await repo.dokoncit(op.id, zaver)
  return zaver
}

/**
 * Obnova nejasného nebo zaseknutého výdeje. NIKDY neodesílá — jen dohledá
 * podle klíče:
 *   nalezeno (uzavřený, zaplacený odpis)  → úspěch
 *   nalezeno, ale nedokončený účet        → beze změny (HLASKA_UCET_NEDOKONCENY;
 *                                           účet je — chybou ho uzavřít nejde)
 *   nenalezeno po platnosti + rezervě     → chyba (pokladna už požadavek neprovede;
 *                                           smí se zkusit znovu novou operací)
 *   nenalezeno dřív / chyba dohledání     → beze změny (pokladna ho ještě může provést)
 *
 * Dohledání je ČTENÍ — pustí se, kdykoli ho pokladna nabízí (`pos.dohledat`),
 * bez ohledu na schopnost zápisu (N18). Když schopnost mezitím spadne zpět
 * na 'rucne' (vypnutý zápis přes API), nejasná operace by jinak neměla
 * východ: databáze nejasný stav jinou cestou uzavřít nedovolí.
 */
export async function obnovitOperaci(
  op: OperacePos,
  repo: RepoOperaci,
  pos: PosProOperaci,
  tedMs: number,
): Promise<ZaverOperace | { stav: 'beze_zmeny'; duvod: string }> {
  if (op.stav !== 'nejasny_vysledek' && op.stav !== 'odesila_se') {
    return { stav: 'beze_zmeny', duvod: `Obnovuje se jen nejasný výsledek nebo zaseknuté odesílání (stav ${op.stav})` }
  }
  if (typeof pos.dohledat !== 'function') {
    return { stav: 'beze_zmeny', duvod: 'Pokladna neumí požadavek dohledat — ověřte výdej v pokladně ručně a propojte ho nebo ručně doložte' }
  }

  let d: VysledekDohledani
  try {
    d = await pos.dohledat(op.klic)
  } catch (e) {
    return { stav: 'beze_zmeny', duvod: `Dohledání selhalo (${hlaska(e)}) — zkuste to znovu` }
  }

  const posudek = uspechZDohledani(d)
  if (posudek?.stav === 'uspech') {
    await repo.dokoncit(op.id, posudek.zaver)
    return posudek.zaver
  }
  // Účet s klíčem je, ale výdej z něj neplyne: ani úspěch, ani chyba (po platnosti
  // by „chyba" pustila nový pokus a z otevřeného účtu by mohl vzniknout druhý výdej).
  if (posudek?.stav === 'nedokonceny') return { stav: 'beze_zmeny', duvod: HLASKA_UCET_NEDOKONCENY }
  if (!d || d.stav !== 'nenalezeno') {
    return { stav: 'beze_zmeny', duvod: `Dohledání selhalo${d && d.stav === 'chyba' ? ` (${d.duvod})` : ''} — zkuste to znovu` }
  }

  const platnost = op.platnostDo === null ? NaN : Date.parse(op.platnostDo)
  if (!Number.isFinite(platnost)) {
    return { stav: 'beze_zmeny', duvod: 'Neznámá platnost požadavku — nejde rozhodnout, jestli ho pokladna ještě provede; ověřte v pokladně ručně' }
  }
  if (tedMs > platnost + REZERVA_PO_PLATNOSTI_MS) {
    const zaver: ZaverOperace = {
      stav: 'chyba',
      duvod: 'Pokladna požadavek do konce jeho platnosti neprovedla a už ho neprovede — výdej jde zkusit znovu',
    }
    await repo.dokoncit(op.id, zaver)
    return zaver
  }
  return { stav: 'beze_zmeny', duvod: `Pokladna požadavek zatím nezná, ale ještě ho může provést (platnost do ${op.platnostDo})` }
}
