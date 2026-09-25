import { getUser, hasAccess } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase/server";

import type { KlicZalozky } from "./zalozky";

/**
 * Které záložky Docházky se člověku kreslí.
 *
 * Jedno místo, ať se čtyři stránky (Docházka, Můj účet, Výdělky, Zálohy)
 * neptají každá trochu jinak. Otázky jsou TYTÉŽ, jakými si podstránky
 * otevírají dveře — kdyby se rozešly, svítila by záložka, za kterou
 * čeká „Sem nemáte přístup“, nebo by chyběla tam, kam člověk smí.
 *
 *   Docházka  každý (vlastní příchod si píchá i brigádník)
 *   Můj účet  každý, kdo má v téhle firmě zaměstnanecký záznam — na
 *             vlastní mzdu není potřeba oprávnění (zadání mezd, oddíl 4);
 *             bez záznamu není čí účet ukázat (`mamZaznam` níž)
 *   Výdělky   payroll.read v rozsahu z adresy — na /firma tedy s NULL,
 *             což chce firemní členství (vidět cizí výdělek je mzdová
 *             práce, attendance.read ani advances.manage nestačí)
 *   Zálohy    advances.manage v rozsahu, NEBO payroll.read za firmu —
 *             přesně jako stránka Záloh od 2. 9.
 *
 * Je to kreslení, ne zámek. Každá podstránka si právo ověřuje sama.
 */
export default async function zalozkyDochazky(
  tenantId: string,
  branchId: string | null,
): Promise<KlicZalozky[]> {
  const [zaznam, vydelky, vyplaci, mzdyZaFirmu] = await Promise.all([
    mamZaznam(tenantId),
    hasAccess(tenantId, "payroll.read", branchId),
    hasAccess(tenantId, "advances.manage", branchId),
    hasAccess(tenantId, "payroll.read", null),
  ]);

  const ven: KlicZalozky[] = ["dochazka"];
  if (zaznam) ven.push("ucet");
  if (vydelky) ven.push("vydelky");
  if (vyplaci || mzdyZaFirmu) ven.push("zalohy");
  return ven;
}

/**
 * Má přihlášený v téhle firmě (nesmazaný) zaměstnanecký záznam?
 *
 * Tentýž dotaz, kterým se na něj ptá Docházka i Můj účet. Chyba dotazu
 * znamená „ne“ (při nejistotě se odmítá): tady se jen nekreslí záložka,
 * a stránka, na které člověk stojí, si tutéž chybu ohlásí sama.
 */
export async function mamZaznam(tenantId: string): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
