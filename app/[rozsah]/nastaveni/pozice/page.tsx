import { redirect } from "next/navigation";

/**
 * Nastavení → Pozice — ZANIKLO, slilo se do Nastavení → Zařazení.
 *
 * Do 9. 9. 2026 tu byl samostatný seznam pozic vedle samostatné
 * obrazovky Oprávnění. Dva seznamy pro jednu věc byly přesně to, na co
 * si Šéfík stěžoval (docs/zarazeni-misto-roli.md, oddíl 6.1).
 *
 * Stránka se NERUŠÍ, jen přesměrovává. Odkaz na ni už mohl někdo
 * někomu poslat nebo si ho uložit, a mrtvý odkaz v nastavení je horší
 * než o jedno přesměrování delší cesta — stejná úvaha jako u `/zpravy`
 * a `/rozhovory` po sloučení Vzkazů.
 *
 * Akce (`zalozitPozici`, `prejmenovatPozici`, `prepnoutPozici`)
 * zůstávají ve vedlejším `akce.ts` a volá je nová obrazovka. Přesouvat
 * je jinam by znamenalo dvě místa, kde se zakládá zařazení — tedy
 * přesně tu chybu, kvůli které se obrazovky slévaly. Sahá na ně i
 * `lide/akce.ts` přes `najdiNeboZaloz`.
 */
export default async function PoziceZanikly({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;
  redirect(`/${rozsah}/nastaveni/role`);
}
