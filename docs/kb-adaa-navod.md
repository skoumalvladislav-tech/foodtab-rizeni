# Komerční banka — přímé napojení (ADAA): návod

Služba KB „Přímý přístup k účtu“ (Account Direct Access API, KB Business
API). Foodtab čte pohyby (i s variabilním symbolem) a zůstatky firemního
účtu, nic neplatí. Rozhodnutí Šéfíka z 11. 10. 2026. Kód: `lib/kb-adaa.ts`.

Všechno níž je podle dokumentace KB na developers.kb.cz (stránky Software
Statements, Application Registration – OAuth2, Tokens, Accounts,
Transactions). Co dokumentace neříká jednoznačně, je na konci.

## Kolik to stojí

- **KB (MojeBanka Business):** od 1. 11. 2025 je 50 využití měsíčně
  zdarma. Počítá se stažení pohybů i zůstatku (po stránkách nejvýš 100
  záznamů), seznam účtů je zdarma. Stahování jednou za hodinu stojí
  100 Kč měsíčně, každých 10 minut 500 Kč měsíčně. Platí majitel účtu.
  Foodtab stahuje výchozí 1× denně a zůstatek ob den, takže se vejde do
  bezplatných 50 (zhruba 31 + 15 využití). Interval jde u připojení změnit.
  První připojení s historií spotřebuje víc, jednorázově (viz „Kolik
  stažení spotřebuje první připojení“ níž).
- **Kvalifikovaný certifikát pro elektronickou pečeť** (I.CA nebo
  PostSignum, s názvem firmy a IČO): kolem 858 Kč s DPH na rok u I.CA.
  Je potřeba **jen pro ostrý provoz** a **jen jednou ročně**, na vydání
  „software statementu“. Na serveru Foodtabu certifikát není.

## Krok 1 — portál KB (jednou, Šéfík)

1. Zaregistrujte se na **https://developers.kb.cz** (samoobslužně, e-mail).
2. Založte aplikaci a vytvořte API klíče. Každá služba má vlastní klíč
   a sandbox (testovací prostředí) a produkce jsou zvlášť:
   - **Client Registration** (v sandboxu „ClientRegistrationSandbox-v3“):
     jen pro krok 2, na server nepatří.
   - **OAuth2-v3** → do Vercelu jako `KB_ADAA_API_KEY_OAUTH`.
   - **AccountDirectAccessAPI-v2** → do Vercelu jako `KB_ADAA_API_KEY_DATA`.

## Krok 2 — software statement (jednou za 12 měsíců, Šéfík na svém PC)

Potvrzení od KB, že aplikace Foodtab patří vaší firmě. Platí 12 měsíců,
KB na kontaktní e-mail pošle připomínku.

**Sandbox, bez certifikátu:**

```bash
KB_API_KEY_CLIENT_REGISTRATION="<klíč Client Registration Sandbox>" node scripts/kb-software-statement.mjs --prostredi sandbox --email vas@email.cz
```

**Produkce, s certifikátem pečeti (.p12/.pfx):**

```bash
KB_API_KEY_CLIENT_REGISTRATION="<klíč Client Registration>" KB_CERT_HESLO="<heslo k certifikátu>" node scripts/kb-software-statement.mjs --prostredi produkce --email vas@email.cz --cert pecet.p12
```

Příkaz vypíše dlouhý řádek (JWT). Ten patří do Vercelu jako
`KB_ADAA_SOFTWARE_STATEMENT`. V něm jsou zapsané návratové adresy
Foodtabu (`/api/integrace/kb/registrace` a `/api/integrace/kb/vratit`
na https://foodtab-rizeni.vercel.app). Při změně domény je potřeba nový.

## Krok 3 — Vercel (na pokyn)

| proměnná | hodnota |
|---|---|
| `KB_ADAA_PROSTREDI` | `sandbox` (zkouška s ukázkovým účtem) nebo `produkce` |
| `KB_ADAA_SOFTWARE_STATEMENT` | JWT z kroku 2 (pro dané prostředí) |
| `KB_ADAA_API_KEY_OAUTH` | API klíč OAuth2-v3 (pro dané prostředí) |
| `KB_ADAA_API_KEY_DATA` | API klíč AccountDirectAccessAPI-v2 (pro dané prostředí) |

Bez všech čtyř se karta „Komerční banka“ v appce jen vysvětlí a nic
nenabízí.

## Krok 4 — MojeBanka Business (jednou, statutár nebo zmocněnec)

Podle podpory KB musí přímý přístup přes API aktivovat a účty přiřadit
majitel, zmocněná nebo statutární osoba:
**Open banking → Přístup k účtům KB → Nastavení přímého přístupu k účtům
přes API.** Když KB při připojení vrátí `SERVICE_NOT_SUBSCRIBED`, služba
ještě není aktivovaná.

## Krok 5 — v appce

**Finance → Integrace → Banka → Komerční banka — přímé napojení.**
Vyberte platební účet a „Načíst pohyby od“, pak **Připojit Komerční banku**:
1. KB: přihlášení a potvrzení registrace aplikace KB Klíčem;
2. KB: souhlas s přístupem a výběr účtu;
3. zpět ve Foodtabu: když jste vybrali jeden účet, appka ho připojí
   a hned stáhne pohyby. Víc účtů = vyberete, který patří k platebnímu účtu.

Když okno KB zavřete dřív, než se vrátíte do Foodtabu, zůstane připojení
ve stavu „Připojuje se…“ a nabídne **Dokončit připojení v KB** (začne
znovu od registrace, na stejném platebním účtu).

Souhlas platí 12 měsíců. Měsíc před koncem appka upozorní a nabídne
**Obnovit souhlas v KB** (jen nový souhlas, registrace zůstává). Souhlas
musí obnovit tentýž uživatel KB, který připojení zakládal.

## Co dokumentace KB neříká jednoznačně (dotaz na api@kb.cz)

1. Je ADAA na portálu služba „Open“ (stačí registrace), nebo „Partner“
   (smlouva s KB)? A týká se nás Kodex obezřetného přístupu?
2. `tokenEndpointAuthMethod`: příklady KB používají `client_secret_post`,
   swagger má jen `client_secret_basic`. Foodtab posílá podle příkladů.
3. Filtruje brána KB volání podle IP adres (chyba `REJECTED_BY_FW`)?
   Server Foodtabu (Vercel) nemá pevnou IP.
4. Aktivuje se tarif 100 Kč měsíčně po překročení 50 využití sám, nebo
   ho firma musí objednat?
5. Jak dlouho platí `client_id`/`client_secret` z registrace a co se
   stane s připojením po vypršení software statementu?
6. Parametr `registrationRequest`: portál píše „base64“, starší manuál
   „base64url“ a ukázky to nerozhodnou. Foodtab posílá standardní
   base64 (v adrese zakódované). Když registrace v sandboxu spadne hned
   na začátku, je to první podezřelý.

## Kolik stažení spotřebuje první připojení

Pohyby se stahují po měsících, každé stažení stránky (nejvýš 100 pohybů)
je u KB jedno využití. Připojení s historií od 1. 1. tak napoprvé
spotřebuje zhruba jedno využití na každý měsíc historie a další za každých
100 pohybů navíc. U 9 měsíců a ~10 pohybů denně je to kolem 30 využití,
jednorázově. Jeden běh synchronizace stáhne nejvýš 50 stránek, zbytek
dotáhne další den (u připojení je poznámka „Starší pohyby se ještě
stahují“). Kdo chce bezplatných 50 využití šetřit, zvolí při připojení
kratší „Načíst pohyby od“.

## Text dotazu (k odeslání z firemního e-mailu)

> Dobrý den,
> připojujeme vlastní firemní účet (MojeBanka Business, Foodtab s.r.o.)
> do vlastní aplikace přes Account Direct Access API v2. Prosíme
> o potvrzení:
> 1. Je ADAA pro tento účel dostupné po samoobslužné registraci na
>    developers.kb.cz, nebo je potřeba smlouva s KB? Vztahuje se na nás
>    Kodex obezřetného přístupu?
> 2. Mají se v software statementu a na token endpointu používat
>    `client_secret_post` (jako v příkladech), nebo `client_secret_basic`
>    (jako ve swaggeru Client Registration v3)?
> 3. Filtruje API gateway příchozí volání podle IP adres? Naše aplikace
>    běží na Vercelu bez pevné IP.
> 4. Aktivuje se tarif za stahování nad 50 využití měsíčně automaticky?
> 5. Jak dlouho platí client_id/client_secret z registrace?
> 6. Má být parametr registrationRequest v base64, nebo v base64url?
> Děkujeme.
