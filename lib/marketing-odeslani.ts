import 'server-only'

import { textProKanal } from './marketing.ts'

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
 * Poslední dva se liší jen tím, ČÍ klíč se použije — odesílá se
 * stejně.
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

export async function odeslat(uloha: Uloha): Promise<Vysledek> {
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

  if (!uloha.pripojeni_id || !uloha.ucet_id) {
    return {
      stav: 'chyba',
      duvod: `${nazevKanalu(uloha.kanal)} není připojený. Připojte účet v nastavení marketingu.`,
    }
  }

  /*
    Skutečné odeslání k Metě sem přijde, až bude čím posílat fotky.
    `marketing_media.cesta` ukazuje do Supabase Storage a nahrávání
    fotek zatím není hotové — Instagram bez obrázku nic nepřijme
    a Facebook by dostal holý text.

    Napsat to teď „naslepo" by znamenalo kód, který nikdo nespustil
    a který se tváří, že publikování funguje. Radši ať to řekne
    nahlas: úloha selže se srozumitelnou hláškou a zůstane ve frontě.
  */
  return {
    stav: 'chyba',
    duvod:
      `Zveřejňování na ${nazevKanalu(uloha.kanal)} zatím není hotové — ` +
      'chybí nahrávání fotek. Do té doby použijte ruční režim.',
  }
}

function nazevKanalu(kanal: string): string {
  return kanal === 'instagram' ? 'Instagram' : kanal === 'facebook' ? 'Facebook' : kanal
}
