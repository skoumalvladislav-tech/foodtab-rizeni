# Dva nálezy z večerní kontroly — 5. 9. 2026

Obojí změřeno, ne odhadnuto.

---

## 1. Test `krok5_scenar.sql` padá podle kalendáře

Zkouška proti opravdovému PostgreSQL nad `829be68`:

```
SPADLÉ SCÉNÁŘE: krok5_scenar.sql
Kontrol prošlo: 727
ERROR: SELHALO: otevřený příchod se nehlásí (2)
```

Marketing po přejmenování prochází. Zato spadl `krok5`, který ještě
včera procházel — a **nezměnil se ani on, ani nic, na čem stojí.**
Změnilo se datum.

### Co se děje

`krok4_scenar.sql` (řádek 270) zakládá Markovi **natvrdo** otevřený
příchod:

```sql
(:'tenant', :'perla', :'marek', 'in', '2026-09-03 07:00+02', '2026-09-03'),
```

Je tam schválně — testuje, že rozpracovaný den nezvyšuje výdělek. Není
k němu odchod a nikdo ho neuklízí.

`krok5_scenar.sql` (řádek 546) pak tvrdí, že Marek má
v okně `current_date - 7 … current_date` **právě jednu** nedokončenou
docházku, a sám si k tomu založí další na `current_date - 1`.

**Pevné datum uvnitř posuvného okna.** Z toho vychází:

| dnes | co krok5 založí | co ještě v okně leží | výsledek |
|---|---|---|---|
| 4. 9. | 3. 9. | 3. 9. (z krok4) | splyne v jeden den → **1, prošlo** |
| 5.–10. 9. | 4. 9. a dál | 3. 9. | dva dny → **2, spadlo** |
| od 11. 9. | | 3. 9. je mimo okno | **1, projde** |

Ověřeno na vlastní databázi: než `krok5` vůbec začne, funkce
`nedokoncena_dochazka` v tom okně už Markovi jeden den vrací —

```
 business_date | zacatek_dne
---------------+-------------
 2026-09-03    | 2026-09-03
```

Takže test **projde jen 4. září a pak zase od 11. září**. Šest dní
bude červený a pak se sám vyléčí. To je horší než rovnou rozbitý test:
až se za rok vrátí, nikdo si nevzpomene.

### Jak to spravit

Nepohybuj hranicí okna a **nepřepisuj datum v krok4** — ono by se to
za rok potkalo znovu. Dvě věci, obě dohromady:

1. **Kontroluj jen ten den, který sis sám založil.** Tedy
   `where n.business_date = current_date - 1`, ne počet přes celé okno.
2. **Ještě lépe: založ si vlastního člověka.** `krok4` to o pár řádků
   níž dělá přesně tak („Pauzová Zkouška", *„ať se to nemíchá
   s Markovými dny výš"*) — takže ten návod už v repozitáři je, jen se
   jím krok5 neřídil.

A prosím **rozbij si to schválně**: posuň v krok4 to datum na
`current_date - 1` a přesvědč se, že opravený krok5 pořád projde. Když
projde i tak, kontrola měří to své a nic cizího.

### A pravidlo do `CLAUDE.md`

Navrhuju do oddílu o testech přidat:

> **Scénář nesmí spoléhat na to, v jakém stavu mu data předal
> předchozí scénář.** Buď si založí vlastního člověka, nebo se ptá
> jenom na to, co sám vytvořil. A **pevné datum v kombinaci
> s posuvným oknem (`current_date - N`) je časovaná nálož** — test pak
> prochází podle kalendáře, ne podle kódu.

---

## 2. Obrazovka a hlídač si protiřečí — každý páruje jinak

Hlídač zapomenutých odchodů po opravě `CRON_SECRET` **běží zeleně**
(běh #36) a v souhrnu stojí:

```
Ohlášeno zapomenutých odchodů: 1
```

Čekal jsem 2 — na docházce Černé Perly visí **dva** nedokončené
příchody, z 31. 8. ve 21:42 a z 3. 9. ve 13:14. Ohlásil se jeden.

Důvod je v kódu a je to skutečná neshoda, ne náhoda:

**`public.ohlasit_zapomenute_odchody`** (migrace
`20260902100000_storno_dochazky.sql`) hledá odchod takhle:

```sql
and not exists (
  select 1 from public.attendance_events o
  where o.employee_id = a.employee_id
    and o.kind = 'out'
    and o.occurred_at > a.occurred_at      -- ← bez omezení na den
)
```

**`public.nedokoncena_dochazka`** (migrace `20260903010000`) páruje
**uvnitř provozního dne** — má `o.business_date = a.business_date`
a seskupuje `group by u.employee_id, u.business_date`.

Takže jakýkoli pozdější odchod — třeba o tři dny později — v očích
hlídače uzavře i starý příchod, kdežto obrazovka ho dál hlásí jako
otevřený. Jeden z těch dvou pohledů je špatně a **pro Šéfíka to
znamená, že aplikace na obrazovce něco vytýká, ale nikdy to
neohlásí.**

### Co s tím

Ne oprava naslepo — nejdřív rozhodni, **co je správně**, a pak to
udělej **na jednom místě pro obojí**:

- Když se páruje **v rámci provozního dne**, otevřený příchod z 31. 8.
  se má ohlásit a hlídač má dostat `business_date` do podmínky.
- Když se páruje **napříč dny**, obrazovka ho hlásit nemá a
  `nedokoncena_dochazka` má přestat seskupovat po dnech.

Já jsem pro **provozní den** — noční směna přes půlnoc je jeden den
a odchod o tři dny později není odchod z té směny, ale nový nepořádek.
Ale je to rozhodnutí o provozu, takže ho **polož Šéfíkovi**, stejně
jako to o dvojím příchodu.

Souvisí to spolu: až bude platit
`docs/rozhodnuti-dvojity-prichod.md`, dvojice otevřených příchodů
u jednoho člověka vzniknout nemá. Tohle je ta samá díra, viděná
z druhé strany.

### Testy

1. Otevřený příchod ze **staršího dne** a odchod z **jiného, pozdějšího
   dne** — obrazovka i hlídač se musí shodnout, jestli je otevřený.
2. Otevřený příchod ve 22:00 a odchod ve 2:15 **téže noci** je
   uzavřený pro obojí (týž provozní den).
3. Hlídač ohlásí každý záznam **právě jednou** i po opakovaném běhu.

---

## Mimochodem: hlavička

`edeee2e` a `scripts/mobil/vyrobit.mjs` jsem si stáhl. Měření pustím
v opravdovém Chromiu s emulací iPhonu a výsledek pošlu zvlášť.
