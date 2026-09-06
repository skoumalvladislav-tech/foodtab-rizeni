# Přihlašování — dotažení, a zbytek z noční práce

Sepsáno 6. 9. 2026. Nahrazuje část 1
`docs/prihlaseni-kodem-a-moje-udaje.md` tam, kde se liší — přibyly dva
nálezy, které v ní nebyly.

---

# ČÁST 0 — Nejdřív dodělej zbytek z noci

Šéfík odpověděl na všech šest otázek v
`docs/odpovedi-na-nocni-praci-2026-09-06.md`, ale zadání jsi ještě
nedostal. **Přečti si ten soubor celý**, tohle je jen seznam:

1. **Krok E** — dopiš `kiosk_zpravy_pinem` do výčtu v `krok19_scenar`.
   Prošel jsem ji: PIN bere, nikde ho ani jeho otisk nevrací, ověřuje
   přes `app.pin_overit`. Do výčtu patří. Do komentáře napiš, kdo a kdy
   to ověřil. Že jsi ji odmítl přejmenovat, bylo správné rozhodnutí.
2. **„Štítek, ne zámek"** — `complete_task` **i** kontrolu
   v `krok3_scenar` v jednom commitu, a sjednoť `krok27`.
3. **Doručení jen v rámci provozního dne**, ve kterém se píchl příchod.
4. **Vzkaz vedení** — pobočku vybírá odesílatel, když patří k víc než
   jedné; na obrazovce ať je napsané, kdo to uvidí.
5. **`CLAUDE.md`, oddíl Konvence** — oprav pravidlo o názvech tabulek
   podle oddílu 4 těch odpovědí.

Teprve potom přihlašování.

---

# ČÁST 1 — Co jsem o přihlašování zjistil

## Chodí, ale nedá se dokončit

Šéfíkovi dorazily tři přihlašovací e-maily do doručené pošty a stejně
se nepřihlásil. Odkaz nese `token=pkce_…`, a takový jde dokončit **jen
v tom prohlížeči, který si o něj řekl** — při odeslání se do jeho
úložiště ukládá tajný protikus. Gmail a Seznam otevírají odkazy ve
svém vlastním prohlížeči, takže se protikus nenajde.

## Aplikace si uživatele nepamatuje — a mechanismus přitom funguje

Tohle jsem čekal jako první příčinu a **byl jsem vedle.** `proxy.ts`
(v Next 16 se tak jmenuje bývalý middleware) obnovuje přihlašovací
cookie při každém požadavku a jeho `matcher` pokrývá všechny stránky.
Obnova je tedy napsaná správně.

**Nastavení sezení v Supabase je vyloučené.** Šéfík to 6. 9. ověřil:
*Time-box user sessions* = 0 (never), *Inactivity timeout* = 0
(never), jedno sezení na uživatele vypnuté, platnost přístupového
tokenu 3600 s. Supabase tedy nikoho neodhlašuje — sezení má vydržet,
dokud vydrží cookie v telefonu.

**Zbývají dva podezřelí a oba jsou na straně telefonu:**

1. **Aplikace přidaná na plochu iPhonu má vlastní úložiště**, oddělené
   od Safari. Kdo se přihlásí v Safari, v ikoně na ploše přihlášený
   není. Tohle sedí na Šéfíkův popis nejlíp.
2. **Safari zkracuje životnost cookie zapsané javascriptem na 7 dní.**
   Cookie zapsaná serverem tomu nepodléhá.

Obojí se řeší v části 2, body 3 a 4. **Nehledej to v nastavení
Supabase, tam nic není.**

Z toho plyne tvůj úkol u bodu 3: **ověř, že přihlašovací cookie
zapisuje server, ne javascript v prohlížeči.** `/auth/callback` je
route handler, takže by to tak být mělo — ale ověř to a napiš, na čem
jsi to viděl. Kdyby se sezení zakládalo v prohlížeči, končí lidem po
týdnu a nikdo nepozná proč.

## Odhlásit se nejde vůbec

Prohledal jsem Moje údaje i rozcestník: **slovo „odhlásit" není
v aplikaci nikde.** Není to kosmetika — na sdíleném telefonu za barem
se nedá přepnout člověk a Šéfík se nemůže přihlásit jako číšník, aby
viděl, co číšník vidí.

---

# ČÁST 2 — Co udělat

## 1. Kód místo odkazu

**Šablona e-mailu** (Supabase → Authentication → Email Templates →
Magic Link). Dnes chodí anglicky — *„Your sign-in link"* — a podle
`CLAUDE.md` mají být texty pro lidi česky. Nová podoba:

> **Předmět:** Foodtab — přihlašovací kód
>
> Váš kód pro přihlášení do Foodtabu:
>
> **`{{ .Token }}`**
>
> Platí několik minut a použije se jednou. Opište ho do aplikace, kde
> jste o něj požádali. Když jste o kód nežádali, nic nedělejte.

Odkaz nech pod kódem a menším písmem — pro toho, kdo čte poštu na
tomtéž počítači, je pohodlnější. Kód je hlavní cesta.

**Obrazovka** (`app/prihlaseni/formular.tsx`). Po odeslání se **na
tomtéž místě** objeví pole na kód:

- *„Kód jsme poslali na …"*
- jedno pole, `inputMode="numeric"` a **`autoComplete="one-time-code"`**
  — bez toho iPhone kód nenabídne z oznámení a je to poloviční řešení,
- **Poslat znovu** zašedlé 60 vteřin. Šéfík si vyžádal tři kódy během
  tří minut a platil jen poslední; z obrazovky to poznat nešlo,
- ať jde **změnit e-mail** bez načtení stránky znovu.

Ověření `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
Hlášky česky, bez čísel chyb. Neznámý e-mail dostane **stejnou
odpověď** jako známý.

## 2. Odhlásit se

**Na Moje údaje, dole, oddělené od zbytku.** Ne v horní liště — tam
už není místo a omylem ťuknutý odhlas uprostřed směny je horší než
o jedno ťuknutí delší cesta.

Po odhlášení **smaž sezení pořádně** (`supabase.auth.signOut()`
a zahoď cookie) a přesměruj na přihlášení.

**Na kiosku ne.** Tam se odhlašuje samo po nečinnosti — to je hotové
v kroku E.

## 3. Aby se člověk nemusel přihlašovat znovu

- Ověř, že cookie zakládá **server**, ne prohlížeč (viz výš), a napiš,
  na čem jsi to viděl.
- **Nikde neukládej sezení do `localStorage`.**
- Po přihlášení ať se člověk vrátí tam, odkud šel, ne na rozcestník.

## 4. „Nejdřív na plochu, pak se přihlas"

Na iPhonu má aplikace na ploše vlastní úložiště. Kdo se přihlásí
v Safari a pak si ji přidá na plochu, je v ní nepřihlášený — a vypadá
to jako chyba aplikace.

- **Na přihlašovací obrazovce**, když aplikace běží v prohlížeči na
  telefonu a **není** ve standalone režimu (`window.matchMedia(
  '(display-mode: standalone)')`), ukaž větu: *„Přidejte si Foodtab na
  plochu ještě před přihlášením — jinak se budete muset přihlásit
  dvakrát."*
- Stejnou větu doplň na list s QR (`docs/qr/foodtab-apka-a4.pdf`,
  generuje `udelej_apka_qr.py`) — dnes tam pořadí není.

## 5. Co teď nedělat

**Přihlášení telefonem přes SMS.** Pole na kód je pro to správné
místo a v rozhodnutích stojí, že telefon je plnohodnotný přihlašovací
údaj — ale teď to nedělej. Jen tomu nezavírej dveře: ať se komponenta
jmenuje podle **kódu**, ne podle e-mailu.

---

# ČÁST 3 — Co udělá Šéfík, ne Code

**Authentication → Sessions je hotové** — ověřeno 6. 9., všechno je
nastavené správně a **nic se tam nemění**.

**Rate Limits — opsáno 6. 9.:**

| co | kolik |
|---|---|
| odeslané e-maily | **30 / hodinu** za celý projekt |
| ověření kódu (token verifications) | 30 / 5 minut **na IP adresu** |
| přihlášení a registrace | 30 / 5 minut **na IP adresu** |
| obnovy sezení | 150 / 5 minut na IP |

**Šéfík zvedne e-maily na 100/h** dřív, než rozešle pozvánky: deset
pozvánek, kde si půlka lidí nechá kód poslat podruhé, je přes dvacet
zpráv, a po překročení stropu se e-maily tiše zahazují — člověk vidí
„kód odeslán" a nepřijde nic. Vlastní odesílání přes Resend už
nastavené je (pošta chodí z `noreply@foodtab.cz`), takže tam žádné
omezení služby nestojí, jen ta hodnota v poli.

**Pro tebe z toho plyne jedna věc:** limity na ověření a přihlášení
jsou **na IP adresu**, a celá provozovna má jednu IP, když jsou lidi
na wifi. Dvanáct lidí, kteří se ráno hlásí ze stejné sítě, se do 30
za 5 minut vejde, ale ne s velkou rezervou.

Proto **odliš hlášku „moc pokusů" od „špatný kód"**. Supabase vrací
u překročení stropu jiný stav (429) — chytni ho a řekni: *„Zkoušeli
jsme to moc rychle za sebou. Počkejte prosím pár minut."* Když to
splyne s „kód nesedí", bude Šéfík hledat chybu tam, kde žádná není. Až se na Perle bude registrovat osm lidí najednou, ten
strop se potká s realitou — a je lepší ho znát dopředu než ve chvíli,
kdy před tabletem stojí fronta.

---

# Testy

1. Kód z e-mailu **projde** a přihlásí.
2. **Špatný** kód neprojde, hláška je česky.
3. **Vypršelý** kód neprojde.
4. Kód **nejde použít dvakrát**.
5. Nový kód **zneplatní** předchozí.
6. Neznámý e-mail dostane **stejnou odpověď** jako známý.
7. „Poslat znovu" je **60 vteřin** zašedlé.
8. **Odhlášení** vyhodí ven a po něm se nedá vrátit zpět tlačítkem
   prohlížeče.
9. Přihlášení **drží** po zavření a znovuotevření aplikace.
10. Věta o přidání na plochu se ukáže **jen v prohlížeči**, ne
    v aplikaci na ploše.

A pravidlo z `CLAUDE.md`: **u každé nové kontroly rozbij schválně to,
co má hlídat, a přesvědč se, že spadne.**
