# Přihlašování kódem a Moje údaje v rámu aplikace

Zadal Šéfík 5. 9. 2026 večer, poté co se sám nedostal do aplikace
z telefonu.

---

# ČÁST 1 — Přihlašování musí být přívětivé

## Co se stalo a proč to není náhoda

Šéfíkovi dnes v 18:14, 18:15 a 18:17 **dorazily tři přihlašovací
e-maily do doručené pošty** — odesílání funguje, spam v tom není.
Přesto se nepřihlásil.

Odkaz v e-mailu vypadá takhle:

```
…/auth/v1/verify?token=pkce_3175e169…&type=magiclink&redirect_to=…
```

To `pkce_` je jádro věci. Při odeslání formuláře si prohlížeč uloží
tajný protikus (`code verifier`) do svého úložiště a **odkaz jde
dokončit jen v tom samém prohlížeči.** Na telefonu se to rozejde
skoro vždycky: člověk požádá o odkaz v aplikaci na ploše nebo
v Safari, ale Gmail nebo Seznam ho otevře **ve svém vlastním
prohlížeči**. Jiné úložiště, žádný protikus, odkaz neplatí.

Na iPhonu je to horší, než to zní: **aplikace přidaná na plochu má
vlastní úložiště, oddělené od Safari.** Takže i když se člověk
přihlásí v Safari, v aplikaci na ploše přihlášený není.

To není chyba nastavení, kterou by šlo doladit. Je to vlastnost
přihlašování odkazem a **narazí na ni každý číšník, kterého Šéfík
pozve.**

## Co s tím: posílat kód, ne odkaz

Místo odkazu chodí **šestimístný kód**, který člověk opíše tam, kde
stojí. Žádné přeskakování mezi prohlížeči, žádné „odkaz už neplatí".
Přesně tenhle způsob dnes používají banky i většina docházkových
aplikací, a to ne náhodou.

### Co udělat

**1. Šablona e-mailu v Supabase** — Authentication → Email Templates →
Magic Link. Do textu přijde `{{ .Token }}`, tedy ten kód.

Dnes ten e-mail chodí **anglicky**: *„Your sign-in link. Follow the
link below to sign in."* To je první věta, kterou nový zaměstnanec od
aplikace uslyší, a podle `CLAUDE.md` mají být texty pro lidi česky.
Nová podoba, česky a stručně:

> **Předmět:** Foodtab — přihlašovací kód
>
> Váš kód pro přihlášení do Foodtabu:
>
> **`{{ .Token }}`**
>
> Platí několik minut a použije se jednou. Opište ho do aplikace, kde
> jste o něj požádali. Když jste o kód nežádali, nic nedělejte.

**Odkaz v tom e-mailu nech, ale až pod kódem a menším písmem** — pro
toho, kdo si čte poštu na tomtéž počítači, je pohodlnější. Kód je
hlavní cesta, odkaz je záložní.

**2. Obrazovka přihlášení** (`app/prihlaseni/formular.tsx`). Dnes po
odeslání skončí u hlášky „e-mail odeslán". Nově se **na tomtéž místě**
objeví pole na kód:

- Nadpis: *„Kód jsme poslali na skoumalvladislav@gmail.com"*
- Jedno pole, `inputMode="numeric"` a **`autoComplete="one-time-code"`**.
  To druhé je důležité: iPhone pak kód nabídne rovnou z oznámení a
  člověk nemusí nikam přepínat. Bez toho je to poloviční řešení.
- Tlačítko **Přihlásit se**.
- Pod tím *„Poslat znovu"*, ale **zašedlé 60 vteřin**. Šéfík si dnes
  vyžádal tři kódy během tří minut a platil jen ten poslední —
  z obrazovky to poznat nešlo.
- Ať jde **změnit e-mail** bez načtení stránky znovu (překlep v adrese
  je nejčastější důvod, proč nic nechodí).

Ověření: `supabase.auth.verifyOtp({ email, token, type: 'email' })`.

**3. Hlášky česky a bez čísel chyb.** Špatný kód → *„Kód nesedí.
Zkontrolujte ho, nebo si nechte poslat nový."* Vypršelý → *„Kód už
neplatí. Nechte si poslat nový."*

**4. Nikdy neprozrazuj, jestli adresa existuje.** Po odeslání ať je
odpověď stejná pro známý i neznámý e-mail — jako dnes. Jinak jde
seznam zaměstnanců zjistit hádáním.

**5. Na QR a kiosek nesahej.** Ty fungují a mají svou cestu.

## Čeho se bojím

**Omezení počtu odeslání.** Supabase má strop na kolik kódů za hodinu
pošle. Až se bude na Perle přihlašovat osm lidí najednou, může se
strop potkat s realitou. Zjisti, jaký je (Authentication → Rate
Limits), napiš ho do komentáře, a **až ho někdo překročí, ať to
obrazovka řekne narovinu** — ne „něco se pokazilo".

**Zapamatovat přihlášení.** Číšník se nemá přihlašovat každý den. Ověř,
že sezení drží dlouho a že se obnovuje samo i v aplikaci na ploše.
Kdyby to znamenalo kód jednou za týden, celý ten úklid je k ničemu.

## Co teď nedělat

**Přihlášení telefonem přes SMS.** V rozhodnutích stojí, že telefon je
plnohodnotný přihlašovací údaj, a tahle obrazovka je pro to správné
místo — pole na kód je stejné, jen se mění, kudy kód přijde. **Ale
teď to nedělej**, jen tomu nezavírej dveře: ať se komponenta jmenuje
podle kódu, ne podle e-mailu.

## Testy

1. Kód z e-mailu **projde** a přihlásí.
2. **Špatný kód** neprojde a hláška je česky.
3. **Vypršelý kód** neprojde.
4. Kód **nejde použít dvakrát**.
5. Nový kód **zneplatní ten předchozí**.
6. Neznámý e-mail dostane **stejnou odpověď** jako známý.
7. „Poslat znovu" je **60 vteřin zašedlé**.
8. Přihlášení **drží** po zavření a otevření aplikace na ploše.

---

# ČÁST 2 — Moje údaje patří do rámu aplikace

## Co je špatně

`/moje-udaje` se kreslí **mimo rozhraní aplikace**: tmavý pruh
s nápisem Foodtab, a nic víc. Ověřeno na nasazené verzi — chybí levý
sloupec, spodní lišta i řádka modulů. Člověk, který se tam dostane,
vypadne z aplikace a jedinou cestou zpět je jedno tlačítko.

**A to tlačítko není vidět.** „Zpět do aplikace" má poměr kontrastu
**1,03** — tmavé písmo na tmavém pruhu. To není málo čitelné, to je
neviditelné; na Šéfíkově obrazovce je z něj jen tmavý obdélník.

## Proč to tak je a co s tím

V `app/moje-udaje/layout.tsx` je ten důvod poctivě napsaný: osobní
údaje leží mimo `/[rozsah]/`, protože **se na ně musí dostat i ten,
komu ještě nikdo nepřidělil oprávnění** — takový člověk žádný platný
rozsah nemá a rám by se neměl z čeho postavit.

Ten důvod platí a **nesmí se zahodit**. Řešení je proto obojí:

- **Kdo rozsah má** (drtivá většina) → Moje údaje se kreslí
  v **normálním rámu aplikace**, se sloupcem i spodní lištou, jako
  každá jiná obrazovka. Je to i tak vedené v nabídce
  (`app/[rozsah]/nabidka.ts`, položka `moje-udaje`).
- **Kdo rozsah nemá** → zůstane dnešní tichý rám. Je to výjimka pro
  pár minut mezi pozvánkou a přidělením práv, ne výchozí stav.

**Neřeš to přesunutím pod `/[rozsah]/`.** Adresa má zůstat, kde je;
mění se jen to, čím se obalí.

**A ať to tlačítko je vidět** — pro případ, kdy tichý rám opravdu
nastane. Tlačítko určené na světlý papír nepatří na tmavý pruh; použij
podobu pro tmavé pozadí a **ověř kontrast**, ne od oka.

## Prověrka ostatních oken

Prošel jsem všechny obrazovky na nasazené aplikaci. Rám drží všude —
Směny, Docházka, Úkoly, Nástěnka, Zálohy, Upozornění, Lidé, Šablony,
Menu i Marketing mají lištu, sloupec i spodní lištu a nikde jsem
nenašel text pod kontrastem 3. Mimo rám jsou:

| obrazovka | stav |
|---|---|
| `/moje-udaje` | **špatně** — viz výš |
| `/prihlaseno-z-qr` | samostatná schválně, ale **ověř, že z ní vede zřetelná cesta dál** |
| `/prihlaseni`, `/pozvanka/…`, `/kiosek` | správně samostatné |

## Testy

1. Kdo má rozsah, vidí Moje údaje **v rámu** — sloupec i spodní lišta.
2. Kdo rozsah nemá, se na Moje údaje **pořád dostane**.
3. V tichém rámu je „Zpět do aplikace" **vidět** (kontrast ≥ 4,5).
4. Na 375 i 430 px se **nedá posunout do strany**.
