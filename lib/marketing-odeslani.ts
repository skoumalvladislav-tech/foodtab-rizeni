import 'server-only'

import { coNejde, zkontrolovat } from './marketing-kanaly.ts'
import { textProKanal } from './marketing.ts'
import { n8nJeNastaveny, predatN8n, type Obrazek } from './marketing-n8n.ts'

/**
 * Odeslání jedné publikační úlohy ven.
 *
 * ---------------------------------------------------------------------
 * CO TENHLE SOUBOR NEROZHODUJE
 *
 * Nerozhoduje, jestli se SMÍ poslat. To je věc databáze — `public.
 * marketing_vyzvednout_publikace` ověřuje platnost schválení a práva
 * k fotkám a co neprojde, vůbec nevrátí. Tady se řeší jedině KAM to
 * poslat a co dělat s odpovědí.
 *
 * Kdyby se tu dělalo obojí, vznikly by dvě místa, kde je napsané, co
 * se smí zveřejnit — a ta se rozejdou (CLAUDE.md, pravidlo 2 v duchu).
 *
 * ---------------------------------------------------------------------
 * ČTYŘI REŽIMY
 *
 *   demo        — nikam se nic neposílá. Zapíše se, že by to odešlo,
 *                 a označí se `je_nanecisto`. Nesmí to jít splést
 *                 se skutečností ani na obrazovce, ani v číslech.
 *   rucni       — člověk to zveřejní sám. Úloha se odloží k ruční
 *                 práci; automat se jí nedotýká.
 *   zakaznicky  — účet zákazníka u poskytovatele.
 *   foodtab     — účet Foodtabu.
 *
 * Poslední dva se liší jen tím, ČÍ účet se použije. Odesílá se
 * stejně, a to PŘES n8n — Foodtab s Instagramem nemluví sám.
 * Proč, je v `lib/marketing-n8n.ts`: přístup k účtu tam už leží
 * a mít týž token na dvou místech znamená, že se při odvolání na
 * jedno z nich zapomene.
 */

/** Co si fronta vyzvedla. Odpovídá návratu `marketing_vyzvednout_publikace`. */
export type Uloha = {
  id: string
  tenant_id: string
  branch_id: string
  prispevek_id: string
  verze_id: string
  kanal: string
  format: string
  poskytovatel: string
  rezim: string
  pripojeni_id: string | null
  ucet_id: string | null
  idempotencni_klic: string
  /*
    CO POSKYTOVATEL POVOLIL PRO TENHLE ÚČET.

    Nepovinné: dokud se účty nenačítají, je to prázdné a pravidla
    kanálu podle toho NEODMÍTAJÍ. Tvrdit „váš účet to neumí" proto,
    že jsme se nezeptali, je horší než to zkusit.
  */
  schopnosti_uctu?: string[]
  pokusy: number
  max_pokusu: number
  texty: Record<string, unknown>
  media_ids: string[]
}

/**
 * Jak dopadlo odeslání.
 *
 * `rucne` je schválně třetí možnost vedle `hotovo` a `chyba`. Kdyby
 * ruční režim spadl pod „chybu", vypadal by v přehledu jako porucha
 * a někdo by ho šel opravovat — přitom je to normální stav, který jen
 * čeká na člověka.
 */
export type Vysledek =
  | { stav: 'hotovo'; externiId: string | null; odkaz: string | null; nanecisto: boolean; odpoved: unknown }
  | { stav: 'rucne'; duvod: string }
  | { stav: 'chyba'; duvod: string }

export async function odeslat(uloha: Uloha, obrazky: Obrazek[] = []): Promise<Vysledek> {
  const popisek = textProKanal(uloha.texty, uloha.kanal)

  if (uloha.rezim === 'demo') {
    return {
      stav: 'hotovo',
      // Aby se demo dalo poznat i v odpovědích poskytovatele, ne jen
      // podle příznaku v naší tabulce.
      externiId: `nanecisto-${uloha.idempotencni_klic}`,
      odkaz: null,
      nanecisto: true,
      odpoved: { rezim: 'demo', kanal: uloha.kanal, znaku: popisek.length },
    }
  }

  if (uloha.rezim === 'rucni') {
    return {
      stav: 'rucne',
      duvod: 'Ruční režim: příspěvek je připravený, zveřejní ho člověk.',
    }
  }

  /*
    Na připojení v tabulce `marketing_pripojeni` se tu schválně
    NEČEKÁ. Účet je připojený v n8n, ne ve Foodtabu — kdybychom
    vyžadovali i řádek u nás, byl by to druhý seznam téhož, který se
    dřív nebo později rozejde s tím prvním.
  */

  if (!n8nJeNastaveny()) {
    return {
      stav: 'chyba',
      duvod:
        'Zveřejňování přes n8n není nastavené (chybí adresa nebo tajemství). ' +
        'Do té doby použijte ruční režim.',
    }
  }

  /*
    CO SÍŤ ODMÍTNE, SE NEPOSÍLÁ ANI NEZKOUŠÍ.

    Kdybychom to poslali, vypálí se pokus, počká se pět minut, znovu —
    a po pěti kolech se to vzdá s hláškou od Mety, ze které nikdo
    nepozná, že prostě chybí fotka.

    PRAVIDLA JSOU V `lib/marketing-kanaly.ts`, NE TADY. Do 14. 9. 2026
    stálo na tomhle místě „bez obrázku neposíláme" pro VŠECHNY sítě
    a hláška mluvila o Instagramu. U Instagramu to platí, u Facebooku
    ne — stránka text bez obrázku přijme. Facebook tím nešel zveřejnit
    textem, ačkoli to síť umí.
  */
  const nalezy = zkontrolovat({
    kanal: uloha.kanal,
    format: uloha.format,
    text: popisek,
    pocetFotek: obrazky.length,
    schopnostiUctu: uloha.schopnosti_uctu ?? [],
  })

  const prekazky = coNejde(nalezy)
  if (prekazky.length > 0) {
    // Do hlášky jdou všechny překážky, ne jen první. Opravit jednu
    // a hned narazit na druhou je zbytečné kolo.
    return { stav: 'chyba', duvod: prekazky.map((n) => n.text).join(' ') }
  }

  const odpoved = await predatN8n({
    tenantId: uloha.tenant_id,
    branchId: uloha.branch_id,
    ulohaId: uloha.id,
    idempotencniKlic: uloha.idempotencni_klic,
    kanal: uloha.kanal,
    format: uloha.format,
    popisek,
    obrazky,
  })

  if (odpoved.stav === 'chyba') {
    return { stav: 'chyba', duvod: odpoved.duvod }
  }

  return {
    stav: 'hotovo',
    externiId: odpoved.externiId,
    odkaz: odpoved.odkaz,
    nanecisto: false,
    odpoved: odpoved.odpoved,
  }
}
