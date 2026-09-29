/**
 * Věty o tom, kdy zpráva vyruší — pro čtenáře a pro odesílatele.
 *
 * Pravidlo doručení (app.doruci_se / app.zaradit_doruceni v databázi):
 *   * ve zvonečku je upozornění HNED, vždycky;
 *   * na telefon hned, když je příjemce na směně (otevřený příchod);
 *   * majiteli na telefon kdykoli (rozhodnutí Šéfíka 22. 9.,
 *     migrace 20260922120000);
 *   * naléhavá zpráva komukoli i mimo směnu;
 *   * „důležitá“ se doručuje jako běžná (neměnit bez otázky 20).
 *
 * Do 27. 9. stálo všem „chodí jen během směny“ — to majiteli ani
 * u naléhavých zpráv neplatilo. Věty se skládají tady, ať se dají
 * ověřit testem (scripts/komunikace.test.mjs) a nerozejdou se mezi
 * obrazovkami.
 */

/** Věta pro ČTENÁŘE: kdy mu budou chodit upozornění do telefonu. */
export function vetaOPushi(v: { pushNastaveny: boolean; jeMajitel: boolean }): { text: string; odkaz: boolean } {
  if (!v.pushNastaveny) {
    return { text: 'Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím nechodí.', odkaz: false }
  }
  if (v.jeMajitel) {
    return {
      text: 'Zprávy se ukazují v aplikaci. Upozornění do telefonu vám jako majiteli chodí kdykoli, i mimo směnu.',
      odkaz: true,
    }
  }
  return {
    text:
      'Zprávy se ukazují v aplikaci. Upozornění do telefonu chodí během vaší směny; naléhavé zprávy i mimo ni, ostatní počkají na váš příchod.',
    odkaz: true,
  }
}

/**
 * Věta pro ODESÍLATELE pod polem na psaní: kdy zpráva příjemce vyruší.
 *
 * Na telefon přijde jen těm, kdo si upozornění do telefonu zapnuli
 * (27. 9. v ostré databázi 3 lidé z 12), a jen když má server klíče
 * VAPID. Do 28. 9. věta slibovala „na telefon přijde, až bude příjemce
 * na směně“ každému — a bez klíčů stála pod sebou se čtenářskou větou
 * „upozornění do telefonu zatím nechodí“. Bez klíčů teď o telefonu
 * mlčí: tu větu detail rozhovoru ukazuje hned pod psaním (`VetaOPushi`)
 * a dvakrát za sebou by jen překážela.
 */
export function vetaODoruceni(v: { smiNalehavou: boolean; pushNastaveny: boolean }): string {
  if (!v.pushNastaveny) {
    return 'Ve zvonečku se zpráva ukáže hned.'
  }
  const zaklad =
    'Ve zvonečku se zpráva ukáže hned. Na telefon přijde těm, kdo mají upozornění zapnutá, až budou na směně — majitelům hned.'
  return v.smiNalehavou ? `${zaklad} Naléhavá přijde na telefon i mimo směnu.` : zaklad
}
