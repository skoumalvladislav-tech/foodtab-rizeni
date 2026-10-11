# Stav k 11. 10. 2026 (večer) — banka: Salt Edge nejde, Komerční banka napřímo (ADAA), opravy synchronizace

## Nejdřív to podstatné

- **Napojení přes Salt Edge v appce nefunguje a fungovat nemůže.** Je
  napsané pro partnerské rozhraní Salt Edge (Partners API v1). To Salt
  Edge 16. 7. 2024 ohlásil jako ukončené a k 16. 7. 2025 jako smazané
  (docs.saltedge.com/v6/changelog). Kontrola průzkumu zjistila, že
  adresa ještě odpovídá, ale stavět na ní nejde. Proti živému API se to
  napojení nikdy nevyzkoušelo.
- **Váš účet u Salt Edge („FoodTab s.r.o.", Open Banking Gateway) je
  klientský.** Dokumentace v6 ho určuje pro firmy, které **mají vlastní
  licenci** k přístupu k účtům (PSD2/AISP). Foodtab ji nemá. Bez licence
  se dokumentovaně jde jen přes partnerský program Salt Edge, na pozvánku
  a se smlouvou. Jestli smí klientský účet připojit KB pod licencí Salt
  Edge, dokumentace neříká. Odpovědět musí Salt Edge písemně.
- **Stav účtu je Pending:** jen vymyšlené banky, nejvýš 10 připojení.
  Stav Test (skutečné banky, 100 připojení na 90 dní) je podle jejich
  podmínek „jen pro testování". Ostrý provoz (Live) vyžaduje písemnou
  smlouvu a technickou kontrolu.

> **ROZHODNUTÍ ŠÉFÍKA (11. 10. 2026):** Komerční banku připojit
> **napřímo přes KB — služba „Přímý přístup k účtu" (ADAA)**, bez
> agregátoru a bez licence. Salt Edge zůstává pozastavený, dokud
> písemně nepotvrdí licenci. Firma má účet v **MojeBanka Business**.
> Tím se mění rozhodnutí ze 7. 10. („první bankovní integrace přes Salt
> Edge Partners"), které stálo na ukončeném rozhraní.

## Proč KB ADAA

Podle stránek KB je to služba pro **podnikatele a firmy** a pro jejich
vlastní systémy a účetní programy. KB sama uvádí desítky účetních
programů, které ji používají. Licence ČNB není potřeba (ta je jen pro
PSD2 přístup k cizím účtům).
- MojeBanka Business: 50 stažení měsíčně zdarma, stahování každou
  hodinu 100 Kč měsíčně, každých 10 minut 500 Kč měsíčně
  ([KB](https://www.kb.cz/cs/kbapi/sluzby-kb-api/primy-pristup-k-uctu)).
- Data: pohyby až 2 roky zpět, zůstatky (účetní i disponibilní),
  oznámení o pohybech, výpisy v PDF.
- Co bude potřeba (podrobnosti doplní průzkum, který právě běží):
  registrace na developers.kb.cz, **kvalifikovaný certifikát pro
  elektronickou pečeť** firmy (I.CA, kolem 858 Kč s DPH na rok),
  jednou za rok obnovit souhlas přes KB Klíč.

## Co je hotové v tomhle PR

Tři chyby v kódu banky, na které průzkum narazil. Projevily by se
u každého agregátoru, i u budoucího napojení na KB:

| chyba | oprava | kde |
|---|---|---|
| „Synchronizovat teď" spouštělo u **každého** připojení synchronizaci Fio. U agregátoru nenašla token, přepnula připojení na „chyba" a hodinová úloha ho už nikdy nevzala | synchronizace se vybírá podle poskytovatele; synchronizace Fio navíc sama odmítne připojení, které není Fio | `lib/banka-synchronizace.ts`, `banka/akce.ts`, `lib/integrace-fio-sync.ts` |
| Po jediné přechodné chybě API přepnula synchronizace agregátoru připojení na „Vyžaduje pozornost" a úloha ho už nikdy nevzala (bere jen „Připojeno") | stav se nemění, jen se zapíše důvod; další běh to zkusí sám | `lib/integrace-saltedge-sync.ts` |
| Chyba zápisu zůstatku se tiše spolkla (supabase-js chybu nevyhazuje, try/catch nic nechytil) | chyba se zapíše k připojení jako poznámka | `lib/integrace-saltedge-sync.ts` |

Obrazovka Banka už netvrdí, že KB jde přes Enable Banking, ani že Salt
Edge jde přes partnerský program. U Salt Edge je místo formuláře
vysvětlení, proč je pozastavený. Formulář by volal ukončené rozhraní.

**Variabilní symbol** (bez něj se platby nespárují s fakturami) staré
rozhraní Salt Edge vůbec neposílá, takže se tu opravit nedá. Napojení
na KB ho podle průzkumu dostane.

## Čísla — a z čeho jsou

- `scripts/banka-synchronizace.test.mjs`: 6 kontrol, zapsáno do CI.
- Schválná rozbití: 2 („vždy Fio" a „název poskytovatele jako vlastnost
  objektu"). Obě spadla na kontrole, na kterou mířila.
- `tsc --noEmit` a `eslint` na změněných souborech čisté.
- **Synchronizace Salt Edge testy nemá** (je `server-only` a v CI se
  vynechává). Opravy v ní jsou ověřené jen typy a čtením.

## Co čeká na Šéfíka

1. Sloučit tenhle PR (beze změny databáze, db push není potřeba).
2. Kroky ke KB ADAA (registrace, certifikát, dotaz na api@kb.cz)
   pošlu, až doběhne průzkum.
3. Volitelně dotaz pro Salt Edge, pokud chcete zálohu: smí klientský
   účet bez licence připojit KB (`kb_oauth_client_cz`) pod licencí
   Salt Edge, a za kolik? V jejich dashboardu zatím nic nezakládejte.

## Na co jsem narazil a nešlo to

- Dokumentace Salt Edge v6 si sama odporuje, jestli stav Test pustí
  skutečné banky. Stránka Statuses říká ano, Quick Start ne.
- Vývojářský portál KB (developers.kb.cz) se načítá až v prohlížeči
  a katalog služeb je za přihlášením. Podrobnosti proto zjišťuji
  z návodů a manuálů KB. Část se ověří až po vaší registraci.

## Nenasazoval jsem

Nic. Žádný merge, žádný db push, žádné proměnné ve Vercelu, v Salt Edge
jsem nic nezakládal.
