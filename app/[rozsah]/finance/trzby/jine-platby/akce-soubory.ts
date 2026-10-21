'use server'

import { createHash } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { getUser, hasAccess, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { getCurrentTenantId } from '@/lib/firma'
import { poznatTypSouboru } from '@/lib/jine-platby-ai-jadro'
import { zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import { overitCestu, zaznamZDuplicity } from '@/lib/jine-platby-soubory'
import { KBELIK_JINYCH_PLATEB, MAX_BAJTU_SOUBORU } from '@/lib/jine-platby-typy'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { klientUlohy } from '@/lib/supabase/uloha'

/**
 * Připojení dokladu, který prohlížeč už nahrál do úložiště.
 *
 * SOUBOR JDE Z PROHLÍŽEČE PŘÍMO DO KBELÍKU `jine-platby` (serverová akce
 * má strop těla 1 MB, fotka z telefonu je větší). Kdo smí kam nahrát,
 * rozhoduje politika úložiště (`jine_platby.zadat`/`.upravit` na pobočce
 * z cesty). Sem chodí jen CESTA — a ta je z prohlížeče návrh:
 *
 *   1. firma z členství (`getCurrentTenantId`), nikdy z formuláře;
 *   2. záznam načtený uživatelským klientem (RLS) a `.eq('tenant_id')`;
 *      na pobočce jen záznam TÉ pobočky; právo zadat/upravit NA POBOČCE
 *      ZÁZNAMU (první linie — databázová funkce ho pro service_role
 *      neověřuje, proto tady a jen tady);
 *   3. cesta přeskládaná z ověřených částí (`overitCestu`) — prefix
 *      firma/pobočka/záznam, uuid a přípona, nic navíc;
 *   4. soubor se STÁHNE (uživatelským klientem — politika kbelíku) a typ
 *      se pozná z OBSAHU (magic bytes, `poznatTypSouboru`), ne z přípony
 *      ani z typu, který deklaroval prohlížeč; velikost ze stažených bajtů;
 *   5. otisk sha256 spočítá server ze stažených bajtů (tentýž soubor nejde
 *      připojit ke dvěma záznamům — unikát v databázi);
 *   6. teprve pak `jine_platby_pripojit_soubor` KLIENTEM SLUŽBY
 *      (`klientUlohy`, service_role) s `p_nahral` = přihlášený: funkce má
 *      grant jen pro service_role, aby otisk a typ podle obsahu mohl zapsat
 *      jen server (přihlášený by jinak poslal vymyšlený otisk a obešel
 *      „stejná fotka podruhé neprojde“). Funkce znovu ověří cestu, vlastníka
 *      souboru v úložišti (= `p_nahral`), typ, velikost a strop 10 souborů.
 *      Uživatelský klient ji nevolá nikdy.
 *
 * Když cokoli od kroku 4 selže (i chybějící klíč služby), soubor se
 * z úložiště smaže (politika pustí smazat jen vlastní soubor, na který
 * neukazuje žádný řádek). Nepovedený úklid se nehlásí: sirotek nikomu
 * neškodí a hláška by zakryla skutečnou chybu.
 */

export type VysledekPripojeni =
  | { ok: true; id: string }
  | {
      ok: false
      chyba: string
      /** Id záznamu, ke kterému už stejný soubor patří (duplicita) — obrazovka na něj dá odkaz. */
      jinyZaznam: string | null
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ne = (chyba: string, jinyZaznam: string | null = null): VysledekPripojeni => ({ ok: false, chyba, jinyZaznam })

export async function pripojitSoubor(rozsah: string, zaznamId: string, cesta: string): Promise<VysledekPripojeni> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return ne('Nejste přihlášen(a), nebo účet nepatří k žádné firmě.')
  if (!UUID.test(String(zaznamId ?? ''))) return ne('Neplatný záznam.')

  const pristup = await zkusPristupJinymPlatbam(tenantId, String(rozsah ?? ''))
  if (pristup.stav !== 'ok') return ne('Nejste přihlášen(a), nebo k Jiným platbám nemáte přístup.')

  const supabase = await getServerSupabase()
  const { data: zaznam, error: chybaZaznamu } = await supabase
    .from('jine_platby')
    .select('id, tenant_id, branch_id, stav_kontroly')
    .eq('id', zaznamId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (chybaZaznamu) return ne('Záznam se nepodařilo načíst. Zkuste to prosím znovu.')
  if (!zaznam) return ne('Záznam se nenašel.')
  const z = zaznam as { id: string; tenant_id: string; branch_id: string; stav_kontroly: string }

  const pobocka = pobockaFinanci(pristup.scope)
  if (pobocka !== null && z.branch_id !== pobocka) return ne('Záznam nepatří téhle provozovně.')
  if (z.stav_kontroly === 'zruseno') return ne('Zrušený záznam už nejde měnit.')

  const [zadat, upravit, uzivatel] = await Promise.all([
    hasAccess(tenantId, 'jine_platby.zadat', z.branch_id),
    hasAccess(tenantId, 'jine_platby.upravit', z.branch_id),
    getUser(),
  ])
  if (!zadat && !upravit) return ne('K záznamu nemáte právo nahrávat doklady.')
  if (!uzivatel) return ne('Nejste přihlášen(a), nebo účet nepatří k žádné firmě.')

  // Cesta, která neprojde, se ani nemaže — nevíme, čí soubor by to byl.
  const overena = overitCestu(String(cesta ?? ''), tenantId, z.branch_id, z.id)
  if (!overena) return ne('Cesta k souboru nesedí s tímhle záznamem.')

  const kbelik = supabase.storage.from(KBELIK_JINYCH_PLATEB)
  const uklidit = async () => {
    try {
      await kbelik.remove([overena.cesta])
    } catch {
      /* viz hlavička: sirotek nevadí */
    }
  }

  const { data: obsah, error: chybaStazeni } = await kbelik.download(overena.cesta)
  if (chybaStazeni || !obsah) {
    await uklidit()
    return ne('Soubor se v úložišti nenašel. Zkuste ho nahrát znovu.')
  }

  const bajty = new Uint8Array(await obsah.arrayBuffer())
  if (bajty.length === 0 || bajty.length > MAX_BAJTU_SOUBORU) {
    await uklidit()
    return ne(bajty.length === 0 ? 'Soubor je prázdný.' : 'Soubor je větší než 10 MB.')
  }

  // Typ podle OBSAHU. Přípona (a tím typ, pod kterým soubor leží v úložišti)
  // musí sedět s tím, co v souboru opravdu je.
  const typ = poznatTypSouboru(bajty)
  if (typ === null || typ !== overena.mime) {
    await uklidit()
    return ne('Obsah souboru neodpovídá fotce (JPEG, PNG, WebP) ani PDF.')
  }

  const otisk = createHash('sha256').update(bajty).digest('hex')

  // SERVICE_ROLE: `jine_platby_pripojit_soubor` smí jen server (otisk a typ ze stažených bajtů).
  // Až po ověření firmy, záznamu (RLS), práva zadat/upravit na jeho pobočce, cesty a obsahu;
  // jen s id ověřeného záznamu, přeskládanou cestou, naším otiskem a id přihlášeného.
  const sluzba = klientUlohy()
  if (!sluzba) {
    await uklidit()
    return ne('Připojení dokladu není na serveru nastavené (chybí SUPABASE_SERVICE_ROLE_KEY). Zkuste to později.')
  }
  const { data: id, error } = await sluzba.rpc('jine_platby_pripojit_soubor', {
    p_zaznam: z.id,
    p_cesta: overena.cesta,
    p_otisk: otisk,
    p_nahral: uzivatel.id,
  })
  if (error) {
    await uklidit()
    if (error.code === '23505') {
      const jiny = zaznamZDuplicity(error.message)
      if (jiny === z.id) return ne('Tenhle soubor už je u tohoto záznamu připojený.')
      // Id druhého záznamu databáze pošle jen na téže pobočce (tu uživatel smí); jinak jen věta.
      return jiny ? ne('Tento soubor už je připojený k jinému záznamu.', jiny) : ne('Tento soubor už je připojený k jinému záznamu na jiné provozovně.')
    }
    // 23514 = obchodní pravidlo s českou hláškou z databáze (strop souborů, typ, vlastník…).
    if (error.code === '23514') return ne(error.message)
    if (error.code === '42501') return ne('K záznamu nemáte právo nahrávat doklady.')
    if (error.code === 'P0002') return ne('Záznam se nenašel.')
    if (funkceNeexistuje(error)) return ne('Jiné platby čekají na aktualizaci databáze. Zkuste to později.')
    console.error('jine_platby_pripojit_soubor selhalo:', error.code, error.message)
    return ne('Soubor se nepodařilo připojit. Zkuste to prosím znovu.')
  }

  revalidatePath(`/${pristup.scope.branchSlug ?? TENANT_SCOPE_SEGMENT}/finance/trzby/jine-platby/${z.id}`)
  return { ok: true, id: String(id ?? '') }
}
