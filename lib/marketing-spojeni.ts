import 'server-only'

// Přípona `.ts` je schválně — soubory v `lib/` se pouštějí přímo Nodem
// v testech a bez ní by modul nenašel (CLAUDE.md, oddíl Testy).
import { lzePripojit, najdiPoskytovatele } from './marketing-katalog.ts'
import { n8nJeNastaveny } from './marketing-n8n.ts'

/**
 * Zkouška spojení, než se připojení zapne.
 *
 * Zadání: master prompt, oddíl 6 („Test připojení před aktivací").
 *
 * ---------------------------------------------------------------------
 * ZKOUŠKA ŘÍKÁ JEN TO, CO OPRAVDU OVĚŘILA
 *
 * U klíče k modelu se dá zavolat poskytovatel a zeptat se ho, jestli
 * ten klíč zná. U n8n se to udělat NEDÁ: jediná adresa, kterou Foodtab
 * zná, je webhook, který příspěvky ZVEŘEJŇUJE. Poslat na něj cokoli
 * „na zkoušku" znamená riskovat příspěvek na Instagramu firmy — a ten
 * se zpátky vzít nedá.
 *
 * Proto se u n8n ověřuje jen to, že je adresa a sdílené tajemství na
 * serveru nastavené, a zkouška to o sobě NAHLAS ŘEKNE. Zelená hláška,
 * která tvrdí víc, než se změřilo, je horší než žádná: podle ní se
 * pozná chyba až po schválení a naplánování.
 *
 * ---------------------------------------------------------------------
 * KLÍČ SE NEDOSTANE DO HLÁŠKY
 *
 * Hlášky z téhle funkce končí v `marketing_pripojeni.posledni_chyba`,
 * což je obyčejný sloupec, který si přečte každý s `marketing.read`.
 * Odpověď poskytovatele se proto zkracuje a nikdy se do ní nevkládá
 * to, co poslal Foodtab.
 */

export type VysledekTestu = { ok: boolean; zprava: string }

/** Kolik čekat na poskytovatele. Delší čekání drží formulář na obrazovce. */
const CEKANI_MS = 10_000

/** Jak dlouhý kus cizí odpovědi se smí uložit do `posledni_chyba`. */
const DELKA_HLASKY = 200

function zkratit(text: string): string {
  const jeden = text.replace(/\s+/g, ' ').trim()
  return jeden.length > DELKA_HLASKY ? `${jeden.slice(0, DELKA_HLASKY)}…` : jeden
}

export async function otestovatSpojeni(
  klic: string,
  rezim: string,
  udaje: Record<string, string>,
): Promise<VysledekTestu> {
  if (!lzePripojit(klic, rezim)) {
    return { ok: false, zprava: 'Tenhle nástroj se v tomhle režimu připojit nedá.' }
  }

  if (rezim === 'rucni') {
    return { ok: true, zprava: 'Ruční režim nikam nevolá — zveřejňuje člověk.' }
  }

  if (rezim === 'demo') {
    return { ok: true, zprava: 'Nanečisto: projde celá cesta a ven se nepošle nic.' }
  }

  if (klic === 'anthropic') {
    const apiKlic = rezim === 'zakaznicky' ? (udaje.klic ?? '').trim() : (process.env.ANTHROPIC_API_KEY ?? '')

    if (!apiKlic) {
      return {
        ok: false,
        zprava:
          rezim === 'zakaznicky'
            ? 'Chybí API klíč.'
            : 'Účet Foodtabu není na serveru nastavený (ANTHROPIC_API_KEY).',
      }
    }

    return await zeptatSeAnthropicu(apiKlic)
  }

  if (klic === 'n8n') {
    return n8nJeNastaveny()
      ? {
          ok: true,
          zprava:
            'Adresa i sdílené tajemství jsou na serveru nastavené. Skutečné odeslání se ' +
            'ověří až zkouškou nanečisto — na publikační webhook se naslepo nic neposílá.',
        }
      : {
          ok: false,
          zprava:
            'Na serveru chybí N8N_MARKETING_URL nebo N8N_MARKETING_TAJEMSTVI. ' +
            'Do té doby zůstává ruční režim.',
        }
  }

  /*
    Sem se dostane jen nástroj, který je v katalogu podporovaný, ale
    zkoušku tu nemá dopsanou. Je to chyba v kódu, ne stav připojení —
    a musí být vidět, ne se tvářit jako úspěch.
  */
  const p = najdiPoskytovatele(klic)
  return { ok: false, zprava: `Pro ${p?.nazev ?? klic} není zkouška spojení napsaná.` }
}

/**
 * Nejlevnější dotaz, který se dá položit: výpis modelů.
 *
 * Nic negeneruje, takže se za zkoušku neplatí, a přitom projde celou
 * cestou ověření klíče. Odpověď se nečte — zajímá nás jen kód.
 */
async function zeptatSeAnthropicu(apiKlic: string): Promise<VysledekTestu> {
  try {
    const odpoved = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': apiKlic,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(CEKANI_MS),
    })

    if (odpoved.ok) {
      return { ok: true, zprava: 'Klíč platí, poskytovatel odpověděl.' }
    }

    if (odpoved.status === 401 || odpoved.status === 403) {
      return { ok: false, zprava: 'Poskytovatel klíč odmítl. Zkontrolujte, že je celý a platný.' }
    }

    return { ok: false, zprava: zkratit(`Poskytovatel odpověděl chybou ${odpoved.status}.`) }
  } catch (e) {
    // Text výjimky může obsahovat adresu, ale ne hlavičky — klíč v ní není.
    return { ok: false, zprava: zkratit(`Spojení se nepovedlo: ${e instanceof Error ? e.message : String(e)}`) }
  }
}
