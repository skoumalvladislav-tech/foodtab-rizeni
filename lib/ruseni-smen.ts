/**
 * Zrušení / smazání směny i v JINÉ DNY najednou.
 *
 * Zadání Šéfíka 14. 10. 2026: „potřebuji u rušení směn označit více dní.“
 * V potvrzení „Zrušit / Smazat tuhle směnu?“ jde zapnout „…i v jiné dny“,
 * vybrat dny ve stejné mřížce jako u zakládání (vyber-dnu.tsx), podívat se
 * na náhled a teprve pak potvrdit.
 *
 * Čistá logika bez Reactu a bez databáze, ať jde zkoušet Nodem
 * (scripts/smeny-ruseni.test.mjs). Kreslí to app/[rozsah]/smeny/
 * ruseni-vice-dni.tsx, načítá a ruší app/[rozsah]/smeny/ruseni.ts —
 * jedno volání RPC `smazat_smenu` za směnu, viz jeho hlavičku.
 *
 * ---------------------------------------------------------------------
 * CO SE V KTERÉM DNI ZRUŠÍ, ROZHODUJE SERVER
 *
 * Prohlížeč posílá jen výchozí směnu a vybrané dny. Které směny v těch
 * dnech „patří k sobě“, spočítá server touhle funkcí (`odpovidaPravidlu`)
 * nad řádky z databáze — ne seznam id, který by poslal prohlížeč. Id
 * z náhledu se posílají zpátky jen jako POJISTKA: když se od náhledu
 * rozpis změnil, server to pozná a nezruší nic (`stejneSmeny`).
 *
 * Vydaná směna se RUŠÍ (zůstane stát jako zrušená a lidem zmizí až
 * vydáním rozpisu), nevydaná se MAŽE. O tom rozhoduje databáze
 * (`public.smazat_smenu`), tady se podle `published_at` jen předpovídá,
 * co se stane, ať to člověk v náhledu vidí. Ve víc dnech se to může
 * míchat, proto je slovo v rozhraní neutrální („Zrušit / smazat“).
 */

import { pocet } from './sklonovani.ts'
import { tydnyOkna, TYDNU_MAX } from './vyber-dnu.ts'

/**
 * Pojistka proti nesmyslně dlouhému výběru, ověřuje se na SYROVÉM vstupu
 * (před odstraněním duplicit) — ať server nezačne zpracovávat pole
 * s tisíci položkami. Rozumný výběr se vejde i do okna mřížky
 * (`TYDNU_MAX` týdnů, 84 dní), které se kontroluje zvlášť.
 */
export const MAX_DNU_RUSENI = 92

/**
 * Strop počtu SMĚN na jedno potvrzení. Strop na dny nestačí: u neobsazené
 * směny se pravidlo týká všech stejných slotů v dni, takže dvanáct týdnů
 * po třech slotech je přes 250 volání `smazat_smenu` v jedné akci — po
 * sobě, každé zakládá upozornění. Kdyby akce narazila na časový limit
 * nebo spadlo spojení uprostřed, část směn by byla pryč a člověk by se
 * nedozvěděl, která. Odmítne se proto dřív: v náhledu i v potvrzení
 * stejně (`najitKeZruseni` v app/[rozsah]/smeny/ruseni.ts).
 */
export const MAX_SMEN_RUSENI = 150
export const TEXT_MOC_SMEN = `Najednou jde zrušit nejvýš ${MAX_SMEN_RUSENI} směn — vyberte méně dní.`

/** Sloupce `public.shifts`, které pravidlo a náhled potřebují. */
export type SmenaKRuseni = {
  id: string
  branch_id: string
  employee_id: string | null
  position_id: string | null
  shift_date: string
  /** `time` z databáze — „HH:MM:SS“ (případně „HH:MM“). */
  starts_at: string
  ends_at: string
  status: string
  published_at: string | null
}

/** Je to opravdové datum RRRR-MM-DD? Roundtrip chytí i „2026-02-31“. */
export function jeIsoDatum(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [r, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(r, m - 1, d)).toISOString().slice(0, 10) === s
}

export type OvereneDny = { ok: true; dny: string[] } | { ok: false; text: string }

/**
 * Ověří dny, které poslal prohlížeč. Vrátí je seřazené, bez duplicit
 * a vždy VČETNĚ dne výchozí směny (ta se ruší v každém případě — kvůli
 * ní se dialog otevřel).
 *
 * Odmítne: víc než `MAX_DNU_RUSENI` položek, cokoli, co není datum,
 * a den mimo okno mřížky (`TYDNU_MAX` týdnů od pondělí týdne výchozí
 * směny) — server nepustí nic, co by obrazovka nenabídla.
 *
 * ROZHODNOUT (docs/hlaseni/otazky.md #49, bod 2): okno začíná PONDĚLÍM týdne výchozí směny, ne jejím dnem,
 * a nehlídá, jestli den není v minulosti. Když se rušení otevře u směny
 * z minulého měsíce, jde jedním potvrzením zrušit (vydané) nebo smazat
 * (nevydané) až dvanáct týdnů už odpracovaných směn. Zrušená vydaná
 * směna pak vypadne z `dnu_bez_dochazky` ve výpočtu mezd (počítá jen
 * `status <> 'cancelled'`), smazané nevydané vezmou s sebou potvrzení
 * a docházce zůstane `shift_id` prázdné. U jedné směny jde totéž, výběr
 * dnů to jen znásobí. Šéfík zatím nerozhodl (viz docs/hlaseni/otazky.md
 * #27 k minulým obdobím) — možnosti:
 *   - nechat, jak je, a v náhledu dny před dnešním provozním dnem jen
 *     označit („minulý den“, v souhrnu „z toho N dní v minulosti“);
 *   - přísně: odmítnout dny dřív než max(den výchozí směny, dnešní
 *     provozní den) a v mřížce je zamknout — pak sem musí přijít „dnes“
 *     jako parametr, ať funkce zůstane čistá a testovatelná.
 */
export function overitDnyRuseni(surove: string[], zakladniDen: string): OvereneDny {
  if (surove.length > MAX_DNU_RUSENI) {
    return { ok: false, text: `Najednou jde vybrat nejvýš ${MAX_DNU_RUSENI} dní.` }
  }
  const dny = [...new Set(surove.map((d) => String(d).trim()).filter(Boolean))]
  for (const d of dny) {
    if (!jeIsoDatum(d)) return { ok: false, text: 'Ve výběru dnů je neplatné datum.' }
  }

  const okno = tydnyOkna(zakladniDen, TYDNU_MAX).flat()
  const od = okno[0]
  const doDne = okno[okno.length - 1]
  for (const d of dny) {
    if (d < od || d > doDne) {
      return { ok: false, text: 'Vybraný den je mimo nabízené týdny.' }
    }
  }

  if (!dny.includes(zakladniDen)) dny.push(zakladniDen)
  return { ok: true, dny: dny.sort() }
}

/** „08:00“ a „08:00:00“ je tentýž čas; porovnává se celé „HH:MM:SS“. */
export function stejnyCas(a: string, b: string): boolean {
  const cele = (t: string) => (t.length === 5 ? `${t}:00` : t)
  return cele(a) === cele(b)
}

/**
 * Patří směna `kandidat` (z JINÉHO vybraného dne) k rušení spolu
 * s výchozí směnou `zaklad`?
 *
 * Vždy: stejná pobočka jako výchozí směna, jiný den než výchozí směna
 * (v jejím dni se ruší jen ona sama, jako dosud) a ne už zrušená.
 *
 * ROZHODNOUT (docs/hlaseni/otazky.md #49, bod 1): pravidlo po dnech je výchozí, opatrné rozhodnutí této
 * relace, Šéfík ho zatím nepotvrdil.
 *   - Výchozí směna MÁ člověka: všechny směny téhož člověka na téže
 *     pobočce v tom dni (i když má jiný čas — „ten den nepřijde“).
 *   - Výchozí směna je NEOBSAZENÁ: neobsazené směny na téže pobočce se
 *     stejnou pozicí a se stejným začátkem i koncem.
 *   Alternativa: i u člověka brát jen směny se stejným časem (od–do)
 *   jako výchozí — pak by dělená směna nebo jiný čas v jiném dni
 *   zůstaly stát.
 *
 *   NESYMETRIE, na kterou je potřeba odpověď: ve dni výchozí směny se
 *   ruší JEN ona, v každém dalším dni VŠECHNO, co pravidlu odpovídá.
 *   Pobočka se třemi stejnými neobsazenými sloty „Číšník 10–22“ denně,
 *   která chce na příští týden ubrat jeden: ve výchozím dni zmizí jeden
 *   slot, v ostatních dnech všechny tři. U člověka ve výchozím dni
 *   zůstane jeho druhá směna, v jiných dnech zmizí všechny. Obrazovka
 *   to říká v textu u volby a náhled ukazuje každou směnu, ale pravidlo
 *   samo je otevřená otázka:
 *     - neobsazená: má se v každém dalším dni rušit jen tolik stejných
 *       slotů, kolik jich jde ve výchozím dni (tedy jeden)?
 *     - člověk: má se i ve výchozím dni rušit jeho další směna?
 */
export function odpovidaPravidlu(zaklad: SmenaKRuseni, kandidat: SmenaKRuseni): boolean {
  if (kandidat.id === zaklad.id) return false
  if (kandidat.branch_id !== zaklad.branch_id) return false
  if (kandidat.shift_date === zaklad.shift_date) return false
  if (kandidat.status === 'cancelled') return false

  if (zaklad.employee_id !== null) return kandidat.employee_id === zaklad.employee_id

  return (
    kandidat.employee_id === null &&
    (kandidat.position_id ?? null) === (zaklad.position_id ?? null) &&
    stejnyCas(kandidat.starts_at, zaklad.starts_at) &&
    stejnyCas(kandidat.ends_at, zaklad.ends_at)
  )
}

/**
 * Co se zruší: výchozí směna a z `kandidati` ty, které leží v některém
 * z vybraných `dny` a odpovídají pravidlu. Seřazené podle dne a začátku,
 * aby se rušilo (a v náhledu ukazovalo) v pořadí kalendáře.
 */
export function vybratKeZruseni(
  zaklad: SmenaKRuseni,
  kandidati: SmenaKRuseni[],
  dny: string[],
): SmenaKRuseni[] {
  const vybrane = new Set(dny)
  const videne = new Set<string>([zaklad.id])
  const dalsi: SmenaKRuseni[] = []
  for (const k of kandidati) {
    if (videne.has(k.id)) continue
    if (!vybrane.has(k.shift_date) || !odpovidaPravidlu(zaklad, k)) continue
    videne.add(k.id)
    dalsi.push(k)
  }
  return [zaklad, ...dalsi].sort(
    (a, b) =>
      a.shift_date.localeCompare(b.shift_date) ||
      a.starts_at.localeCompare(b.starts_at) ||
      a.id.localeCompare(b.id),
  )
}

/** Co s tou směnou udělá `public.smazat_smenu`: vydanou zruší, nevydanou smaže. */
export type AkceRuseni = 'zrusit' | 'smazat'

export function akceRuseni(s: { published_at: string | null }): AkceRuseni {
  return s.published_at ? 'zrusit' : 'smazat'
}

/** Jedna směna v náhledu — co se s ní stane, ještě než se to stane. */
export type PolozkaNahledu = {
  id: string
  den: string
  /** „HH:MM“ */
  od: string
  do: string
  /** Jméno člověka, nebo „Neobsazená směna“. */
  kdo: string
  pozice: string | null
  akce: AkceRuseni
  /** Výchozí směna — ta, u které se dialog otevřel. */
  vychozi: boolean
}

export type DenNahledu = { den: string; smeny: PolozkaNahledu[] }

/**
 * Náhled po dnech: každý vybraný den (v pořadí kalendáře) se směnami,
 * které se v něm zruší — a i den, ve kterém není co rušit (prázdný
 * seznam). Ten se v náhledu ukáže výslovně „nic ke zrušení“, ať člověk
 * nemusí hádat, jestli se na něj zapomnělo.
 */
export function nahledPoDnech(dny: string[], polozky: PolozkaNahledu[]): DenNahledu[] {
  return [...new Set(dny)].sort().map((den) => ({
    den,
    smeny: polozky.filter((p) => p.den === den).sort((a, b) => a.od.localeCompare(b.od)),
  }))
}

function sVelkym(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

/** Počty z náhledu: kolik se zruší, kolik smaže, kolik dnů je bez směny. */
export function pocetNahledu(dny: DenNahledu[]): { zrusit: number; smazat: number; prazdnych: number } {
  const smeny = dny.flatMap((d) => d.smeny)
  return {
    zrusit: smeny.filter((s) => s.akce === 'zrusit').length,
    smazat: smeny.filter((s) => s.akce === 'smazat').length,
    prazdnych: dny.filter((d) => d.smeny.length === 0).length,
  }
}

/** „Ke zrušení 2 směny, ke smazání 3 směny, nic ke zrušení: 1 den.“ (bez tečky) */
export function souhrnNahledu(dny: DenNahledu[]): string {
  const { zrusit, smazat, prazdnych } = pocetNahledu(dny)
  const casti: string[] = []
  if (zrusit > 0) casti.push(`ke zrušení ${pocet(zrusit, 'směna', 'směny', 'směn')}`)
  if (smazat > 0) casti.push(`ke smazání ${pocet(smazat, 'směna', 'směny', 'směn')}`)
  if (prazdnych > 0) casti.push(`nic ke zrušení: ${pocet(prazdnych, 'den', 'dny', 'dní')}`)
  return sVelkym(casti.join(', '))
}

/**
 * Text potvrzovacího tlačítka podle náhledu — říká přesně, co se stane:
 * „Zrušit 3 směny“, „Smazat 1 směnu“, „Zrušit 2 a smazat 3 směny“.
 */
export function textTlacitkaRuseni(dny: DenNahledu[]): string {
  const { zrusit, smazat } = pocetNahledu(dny)
  const smen = (n: number) => pocet(n, 'směnu', 'směny', 'směn')
  if (zrusit > 0 && smazat > 0) return `Zrušit ${zrusit} a smazat ${smen(smazat)}`
  if (zrusit > 0) return `Zrušit ${smen(zrusit)}`
  return `Smazat ${smen(smazat)}`
}

/**
 * Otisk směny tak, jak ji člověk viděl v náhledu: id, den, čas a co se
 * s ní stane. Prohlížeč ho posílá s potvrzením zpátky a server ho skládá
 * znovu z databáze — když se mezitím směna posunula, změnila čas nebo se
 * rozpis vydal (smazat → zrušit), otisky nesedí a nezruší se nic.
 */
export function otiskSmeny(p: { id: string; den: string; od: string; do: string; akce: AkceRuseni }): string {
  return `${p.id}|${p.den}|${p.od}|${p.do}|${p.akce}`
}

/** Otisk řádku z databáze — totéž jako `otiskSmeny` nad položkou náhledu. */
export function otiskRadku(s: SmenaKRuseni): string {
  return otiskSmeny({
    id: s.id,
    den: s.shift_date,
    od: s.starts_at.slice(0, 5),
    do: s.ends_at.slice(0, 5),
    akce: akceRuseni(s),
  })
}

/**
 * Je to tatáž množina směn? Porovnává otisky z náhledu (co člověk viděl)
 * s tím, co server spočítal teď. Pořadí ani duplicity nehrají roli.
 */
export function stejneSmeny(a: string[], b: string[]): boolean {
  const ma = new Set(a)
  const mb = new Set(b)
  if (ma.size !== mb.size) return false
  for (const x of ma) if (!mb.has(x)) return false
  return true
}

/** Výsledek JEDNÉ směny po zavolání `public.smazat_smenu`. */
export type VysledekRuseni = {
  id: string
  den: string
  od: string
  do: string
  /** Co vrátila databáze; `null` = chyba (viz `chyba`). */
  vysledek: 'smazana' | 'zrusena' | 'uz_zrusena' | null
  chyba: string | null
}

/**
 * Odpověď RPC `smazat_smenu` → výsledek. Hlášku chyby píše databáze
 * a je pro člověka — projde beze změny. Nečekaná odpověď bez chyby se
 * bere jako chyba: nevíme, co se stalo, a nesmí to vypadat jako úspěch.
 */
export function vysledekZRpc(
  data: unknown,
  error: { message: string } | null,
): Pick<VysledekRuseni, 'vysledek' | 'chyba'> {
  if (error) return { vysledek: null, chyba: error.message }
  if (data === 'smazana' || data === 'zrusena' || data === 'uz_zrusena') return { vysledek: data, chyba: null }
  return { vysledek: null, chyba: 'Databáze nevrátila, co se se směnou stalo.' }
}

/**
 * Souhrn po zrušení: „Zrušeno 2, smazáno 3, nic ke zrušení: 1 den,
 * 1 chyba“ (bez tečky). Nulové části se vynechávají; chyba se ukáže
 * vždycky, když nějaká je — neúspěch musí být vidět.
 */
export function souhrnRuseni(vysledky: VysledekRuseni[], dnuBezSmen: number): string {
  const zruseno = vysledky.filter((v) => v.vysledek === 'zrusena').length
  const smazano = vysledky.filter((v) => v.vysledek === 'smazana').length
  const uz = vysledky.filter((v) => v.vysledek === 'uz_zrusena').length
  const chyb = vysledky.filter((v) => v.chyba !== null).length
  const casti: string[] = []
  if (zruseno > 0) casti.push(`zrušeno ${zruseno}`)
  if (smazano > 0) casti.push(`smazáno ${smazano}`)
  if (uz > 0) casti.push(`už dřív zrušeno ${uz}`)
  if (dnuBezSmen > 0) casti.push(`nic ke zrušení: ${pocet(dnuBezSmen, 'den', 'dny', 'dní')}`)
  if (chyb > 0) casti.push(pocet(chyb, 'chyba', 'chyby', 'chyb'))
  return sVelkym(casti.join(', ') || 'nic se nezměnilo')
}

/**
 * Barva souhrnu podle výsledku, ne natvrdo zelená (stejná úvaha jako
 * `barvaSouhrnu` u zakládání): bez chyby zelená, nic neprošlo červená,
 * jinak barva varování.
 */
export function barvaRuseni(vysledky: VysledekRuseni[]): string {
  const chyb = vysledky.filter((v) => v.chyba !== null).length
  if (chyb === 0) return 'var(--dobre)'
  if (chyb === vysledky.length) return 'var(--bad)'
  return 'var(--pozor)'
}

/** Stav náhledu (čtecí serverová akce `nahledRuseni`). */
export type StavNahledu =
  | { stav: 'ok'; dny: DenNahledu[] }
  | { stav: 'chyba'; text: string }

/** Stav hromadného zrušení (serverová akce `zrusitViceDni`). */
export type StavRuseni =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; smeny: VysledekRuseni[]; dnyBezSmen: string[] }

/* ---------------------------------------------------------------------
   ROZHODNUTÍ OBRAZOVKY (ruseni-vice-dni.tsx)

   Co obrazovka smí ukázat a potvrdit, je tady — čistě, ať to jde
   zkoušet Nodem. Komponenta drží jen stav a kreslí.
   ------------------------------------------------------------------ */

/** Náhled tak, jak ho drží obrazovka: pro který výběr dnů se načetl a kdy. */
export type NacetlyNahled = {
  /** Klíč výběru dnů, ke kterému se náhled načetl (`klicVyberu`). */
  pro: string
  dny: DenNahledu[]
  /** Pořadí načtení — potvrzení si pamatuje, s kterým náhledem odešlo. */
  verze: number
}

/** Klíč výběru dnů — na pořadí kliknutí nezáleží. */
export function klicVyberu(vybrane: string[]): string {
  return [...vybrane].sort().join(',')
}

/**
 * Náhled, který smí obrazovka ukázat a potvrdit: jen ten, který se načetl
 * přesně pro SOUČASNÝ výběr dnů. Kdo pak den přidá nebo odebere, dostane
 * `null` — potvrzovací tlačítko zmizí, dokud se náhled nenačte znovu.
 * Nepotvrzuje se nic, co nebylo vidět.
 */
export function platnyNahled(nahled: NacetlyNahled | null, vybrane: string[]): NacetlyNahled | null {
  return nahled && nahled.pro === klicVyberu(vybrane) ? nahled : null
}

/**
 * Ukázat zamítnutí potvrzení („Rozpis se od náhledu změnil… Nic se
 * nezrušilo“) místo potvrzovacího tlačítka? Jen když:
 *   - akce právě NEBĚŽÍ — `useActionState` drží až do odpovědi předchozí
 *     stav, takže při druhém odeslání by stará hláška tvrdila „nic se
 *     nezrušilo“, zatímco server ruší směnu za směnou, a tlačítko
 *     „Provádím…“ by zmizelo;
 *   - poslední odpověď je chyba;
 *   - a patří k náhledu, se kterým se odesílalo (`odeslanaVerze`). Dokud
 *     se nenačte nový, znovu potvrdit nejde — stejná data by server
 *     odmítl zase. Po novém náhledu hláška zmizí.
 */
export function jeZamitnuto(
  stav: StavRuseni,
  odeslanaVerze: number | null,
  nahled: Pick<NacetlyNahled, 'verze'> | null,
  ceka: boolean,
): boolean {
  if (ceka) return false
  return stav.stav === 'chyba' && odeslanaVerze !== null && nahled?.verze === odeslanaVerze
}
