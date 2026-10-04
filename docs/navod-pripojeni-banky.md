# Jak připojit bankovní účet k Foodtabu

Tenhle návod je pro majitele/majitelku provozovny, ne pro programátora.
Appka si z banky NIKDY nevezme možnost platit — jen čte zůstatek a
pohyby, abyste je nemuseli zapisovat ručně a aby se párovaly s fakturami.

## Fio banka

Pokud máte účet u Fio, tohle je nejrychlejší cesta a funguje už teď.

1. Přihlaste se do **internetového bankovnictví Fio** (ib.fio.cz).
2. Jděte na **Nastavení → API**.
3. Vytvořte nový token s právem **„Sledování účtu“** — NE
   „Sledování účtu a zadávání platebních příkazů“. Ta druhá volba by
   appce dala i možnost platit, a to appka ani nechce, ani nenabízí.
4. Banka vás požádá o potvrzení SMS kódem nebo v aplikaci — běžné
   ověření, stejné jako u přihlášení.
5. Token (dlouhý řetězec znaků) zkopírujte.
6. V appce: **Finance → Integrace → Banka → Připojit Fio účet**.
   Vyberte, který platební účet v appce se má s tímhle tokenem
   naplnit, token vložte a potvrďte.
7. Appka hned zkusí token použít a řekne vám, jestli to prošlo. Pokud
   ne, zkontrolujte, že jste zkopírovali celý token a že jste
   skutečně zvolili „jen sledování“.

Appka pak sama každých několik hodin stáhne nové pohyby. Zůstatek i
poslední stažení vidíte na stejné stránce. Token kdykoli zrušíte i
přímo v internetovém bankovnictví Fio — appka to při další
synchronizaci pozná a připojení oznámí jako chybné.

## Komerční banka, ČSOB, Česká spořitelna, Raiffeisenbank

Tyhle banky appka nenapojuje přímo (vyžaduje by to zvláštní povolení
od ČNB, které appka nemá) — jede přes prostředníka **Enable Banking**.
Tahle část appky je teď připravená, ale ještě ne zapnutá — čeká se na
jeden krok, který musí udělat provozovatel appky (Foodtab), ne vy:

- Založit si zdarma účet na `enablebanking.com` a vygenerovat
  přístupové klíče.

Jakmile to Foodtab udělá, budete moct svůj účet u KB/ČSOB/České
spořitelny/Raiffeisenbank připojit podobně jako Fio — přihlásíte se
do své banky přes zabezpečené okno, potvrdíte souhlas s přístupem
(appka pak uvidí jen zůstatky a pohyby, nikdy nemůže nic odeslat), a
appka vám ukáže, které účty se povedlo připojit.

## MONETA Money Bank

Tahle banka zatím není podporovaná ani přes Fio, ani přes Enable
Banking. Pokud ji potřebujete, dejte vědět — řešení existuje
(další prostředník, Finbricks), ale vyžaduje obchodní jednání, ne
jen technické nastavení.

## Co appka NIKDY neudělá

- Nepožádá vás o přihlašovací heslo do internetového bankovnictví.
- Nepožádá vás o SMS kód jinak než přímo ve vaší bance (appka ho
  nikdy neuvidí ani neuloží).
- Nikdy nezadá platbu, inkaso ani jiný příkaz z vašeho účtu.
- Nikdy neukáže „Připojeno“, pokud přístup skutečně neověřila.
