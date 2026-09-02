# Zadání: QR na kiosku, který se čte fotoaparátem

Rozhodl Šéfík 2. 9. 2026 po rozvaze nad NFC a čtečkou otisků.

| Otázka | Rozhodnuto |
|---|---|
| Co QR nese | **Odkaz s předvyplněným kódem**, ne jen těch osm znaků |
| Čím se čte | **Běžným fotoaparátem telefonu**. Do aplikace se čtečka nepíše |
| Co udělá otevření odkazu | **Nic nezapíše.** Jen předvyplní kód |
| Textový kód | **Zůstává** pod QR jako záložní cesta |

---

## 1. Proč zrovna takhle

Dnes je na kiosku osm písmen a na Docházce v aplikaci políčko, do
kterého se opisují. QR sám o sobě by nepomohl — v aplikaci **není
žádná čtečka**, takže by ho člověk stejně přečetl očima a přepsal.

Nakreslit QR má smysl jen spolu s tím, kdo ho přečte. Čtečka
s kamerou uvnitř aplikace by byla hezčí, ale je to podstatně víc
práce a na starších telefonech nemusí fungovat. Fotoaparát má každý
a umí ho každý.

Zvažovali jsme i **NFC nálepku** a **čtečku otisků**. Obojí padlo
a je to zapsané v `docs/kontrola-naostro-2026-09-02.md` — NFC neumí
nést kód, který se mění, a otisky prstů jsou biometrie podle čl. 9
GDPR, kterou ÚOOÚ v docházce označil za obhajitelnou jen výjimečně.
**Nestav na nich nic ani později.**

---

## 2. Co je v QR

```
https://<adresa>/<pobocka>/dochazka?kod=CE8CA63E
```

- **Pobočku bere kiosek ze svého zařízení**, ne z ničeho, co přijde
  z prohlížeče. Tablet ví, čí je.
- **Kód je ten, který zrovna svítí.** Překreslí se s ním, tedy
  každých 45 vteřin.
- **Nic dalšího v adrese být nesmí.** Žádné jméno, žádná pobočka
  navíc, žádný druh píchnutí.

### Proč je kód v adrese v pořádku, a co v ní být nesmí

Adresy se zapisují do historie prohlížeče a do záznamů serveru. Tenhle
kód tam smí, protože **žije 45 vteřin a stejně svítí na obrazovce za
barem**, kde ho vidí každý host. Není to tajemství, je to důkaz
přítomnosti.

Jméno, částka ani cokoli o člověku do adresy nepatří — pravidlo
o osobních údajích v adresách platí dál.

---

## 3. Co se stane po naskenování

1. Telefon otevře Docházku té pobočky.
2. **Kód je předvyplněný.** Nic se nezapsalo.
3. Člověk ťukne na **Příchod** nebo **Odchod** — a teprve tím
   píchnutí vzniká.

### Čtyři věci, které se nesmí pokazit

**Otevření odkazu nesmí nic zapsat.** Prohlížeč si adresy načítá
dopředu, člověk stránku obnoví, vrátí se tlačítkem zpět — a pokaždé
by vznikl další záznam. U docházky, ze které se počítá mzda, je to
nepřijatelné. Rozhodnuto už 2. 9., tohle to jen připomíná.

**Kód z adresy je návrh, ne oprávnění.** Ověřuje se na serveru proti
pobočce zařízení přesně tak jako dnes, přes `pichnout_kodem`. To, že
přišel z adresy, na tom nemění nic — je to obdoba pravidla 4.

**Druh píchnutí určuje stav, ne adresa.** Jestli je to příchod nebo
odchod, se pozná z toho, jestli je člověk v práci. Kdyby o tom
rozhodovala adresa, stačilo by podstrčit odkaz a píchnout někomu
opačný směr.

**Po předvyplnění kód z adresy zahoď** (`history.replaceState`), ať
se neveze v historii, v záložce ani ve sdíleném odkazu.

---

## 4. Dva případy, na kterých to jinak spadne

**Kód mezitím vypršel.** Mezi naskenováním a ťuknutím může uplynout
víc než 45 vteřin — u někoho, kdo si musí odemknout telefon, docela
snadno. Server to odmítne a obrazovka musí říct proč:

> **Kód mezitím vypršel.** Na tabletu už svítí jiný — naskenujte ho
> znovu.

Ne „nepovedlo se". Člověk musí vědět, že má jít k tabletu, ne že je
rozbitá aplikace.

**Člověk není přihlášený.** Naskenuje, přistane na přihlášení,
přihlásí se — a než to doklikne, kód je dávno mrtvý. Ať se mu po
přihlášení řekne rovnou:

> Přihlášeno. **Naskenujte kód na tabletu znovu** — ten předchozí už
> mezitím vypršel.

Neschovávej to za obecnou hlášku o vypršení; tohle je jiná situace
a má jiné řešení.

---

## 5. Jak to nakreslit

- **Nepiš vlastní kodér QR.** Vezmi malou, běžně používanou knihovnu
  a **přišpendli přesnou verzi**. Vlastní kodér je tři sta řádků,
  které pak nikdo neudržuje.
- Úroveň korekce **M**, klidová zóna **4 moduly**. Bez klidové zóny
  se QR nechytne, i když vypadá dobře.
- **Dost velký, ať se čte z půl metru** — tablet stojí na baru, člověk
  se k němu nebude sklánět. Ať zabere podstatnou část obrazovky.
- Tmavý na světlém, nikdy naopak.
- **Textový kód zůstane pod ním**, menším písmem. Když se čtečka
  nechytne, opíše se jako dosud.
- Překresluje se spolu s kódem, tedy každých 45 vteřin.

### Ověření

**Dekóduj hotový QR nezávislou knihovnou** — jinou, než kterou jsi
kreslil — a porovnej s očekávanou adresou znak po znaku. Stejnou
knihovnou by se ověřilo jen to, že si rozumí sama se sebou.

Přidej k tomu kontrolu, že se v adrese objevila **správná pobočka**
podle zařízení a **žádný další parametr**.

---

## 6. Co se tím neřeší

Ať je to řečené nahlas: tohle zrychluje píchnutí, **nebrání podvádění**.
Proti tomu, aby někdo píchal z postele, chrání pořád jen to, že kód
existuje jen na tabletu za barem a za tři čtvrtě minuty je k ničemu.

Jestli se ukáže, že je to málo, dalším krokem je **fotka při
píchnutí** — obyčejný snímek, na který se v případě sporu podívá
člověk. Ne rozpoznávání obličejů, to je zase biometrie. Zatím to
nezadáváme.
