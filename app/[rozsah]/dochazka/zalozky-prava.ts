import { hasAccess } from "@/lib/authz";

import type { KlicZalozky } from "./zalozky";

/**
 * Které záložky Docházky se člověku kreslí.
 *
 * Jedno místo, ať se tři stránky (Docházka, Výdělky, Zálohy) neptají
 * každá trochu jinak. Otázky jsou TYTÉŽ, jakými si podstránky otevírají
 * dveře — kdyby se rozešly, svítila by záložka, za kterou čeká „Sem
 * nemáte přístup“, nebo by chyběla tam, kam člověk smí.
 *
 *   Docházka  každý (vlastní příchod si píchá i brigádník)
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
  const [vydelky, vyplaci, mzdyZaFirmu] = await Promise.all([
    hasAccess(tenantId, "payroll.read", branchId),
    hasAccess(tenantId, "advances.manage", branchId),
    hasAccess(tenantId, "payroll.read", null),
  ]);

  const ven: KlicZalozky[] = ["dochazka"];
  if (vydelky) ven.push("vydelky");
  if (vyplaci || mzdyZaFirmu) ven.push("zalohy");
  return ven;
}
