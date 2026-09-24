/**
 * Kiosek: rozlišit „tablet server nezná" od „spojení vypadlo".
 *
 * Do 24. 9. 2026 kiosek obojí ukazoval stejně — „Tablet není
 * připojený" s tlačítkem „Zaregistrovat znovu", které smaže klíč
 * zařízení. Tablet po návratu z jiné aplikace nebo po zavření chvíli
 * nemá síť; první dotaz spadne, na obrazovce je tlačítko, někdo na něj
 * ťukne — a tablet chce nový registrační kód od majitele.
 *
 * Klíč se proto maže JEN tehdy, když databáze výslovně řekne, že ho
 * nezná (`kiosk_stav`: raise … using errcode = 'insufficient_privilege',
 * tedy SQLSTATE 42501). Všechno ostatní — výpadek sítě, pomalý server,
 * 5xx — je výpadek: klíč zůstává a kiosek to zkouší znovu sám.
 */

/**
 * Hláška, kterou funkce kiosku (kiosk_stav, kiosk_zalohy, pichnout_pinem,
 * potvrdit_zalohu_pinem) vracejí na neznámý klíč. Hlídá ji
 * scripts/kiosek.test.mjs proti migracím — kdyby se v databázi změnila,
 * test spadne dřív, než kiosek přestane odpojení poznávat.
 */
export const HLASKA_NEZNAME_ZARIZENI = 'Zařízení není registrované nebo bylo odvolané.'

/**
 * Databáze tenhle klíč nezná (zařízení odvolané nebo nikdy registrované).
 *
 * Nestačí samotný SQLSTATE 42501: ten vrátí PostgREST i tehdy, když
 * funkci chybí právo pro `anon` (třeba po chybné migraci) — a kvůli
 * chybě na serveru se registrace tabletu mazat nemá. Musí sedět i naše
 * hláška.
 */
export function jeOdpojeneZarizeni(chyba: unknown): boolean {
  if (!chyba || typeof chyba !== 'object') return false
  const c = chyba as { code?: unknown; message?: unknown }
  return c.code === '42501' && typeof c.message === 'string' && c.message.includes(HLASKA_NEZNAME_ZARIZENI)
}

/**
 * Co s chybou dotazu kiosku: `odpojeno` jen na výslovné „neznám",
 * všechno ostatní (síť, časový limit, 5xx, chybějící grant) je
 * `vypadek` a klíč zůstává. Jediné místo, kde se to rozhoduje —
 * obrazovka i testy se ptají sem.
 */
export function stavPoChybe(chyba: unknown): 'odpojeno' | 'vypadek' {
  return jeOdpojeneZarizeni(chyba) ? 'odpojeno' : 'vypadek'
}

/** Nepřišla odpověď vůbec (síť, časový limit) — na rozdíl od chyby serveru. */
export function jeSitovaChyba(zprava: string | null | undefined): boolean {
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|abort/i.test(
    zprava ?? '',
  )
}

/**
 * Hláška pro člověka u tabletu. Výpadek sítě z prohlížeče přijde
 * anglicky („TypeError: Failed to fetch", na iPadu „Load failed",
 * „signal timed out") — to se přeloží. Hláška z databáze (česká,
 * třeba „PIN je zamčený") se propustí, jak je. Technický text serveru
 * (HTML brány, „permission denied", „JWT", „API key", PGRST…) na displej
 * u baru nepatří — místo něj výchozí věta.
 */
export function hlaskaKiosku(zprava: string | null | undefined, vychozi: string): string {
  if (!zprava) return vychozi
  if (jeSitovaChyba(zprava)) {
    return 'Spojení se serverem vypadlo. Zkuste to prosím za chvíli znovu.'
  }
  if (/<html|<!doctype|permission denied|jwt|api key|pgrst|internal server error|bad gateway/i.test(zprava)) {
    return `${vychozi} Zkuste to prosím za chvíli znovu.`
  }
  return zprava
}

/**
 * Za kolik milisekund zkusit spojení znovu po `pokus`-tém neúspěchu
 * (1, 2, 3 …): 3 s, 5 s, 10 s, 20 s a dál po 30 s. Tablet na baru
 * nemá kdo obnovit ručně, takže se nevzdává nikdy — jen zpomalí.
 */
export function dalsiPokusZa(pokus: number): number {
  const rady = [3_000, 5_000, 10_000, 20_000]
  if (!Number.isFinite(pokus) || pokus < 1) return rady[0]
  return rady[Math.floor(pokus) - 1] ?? 30_000
}
