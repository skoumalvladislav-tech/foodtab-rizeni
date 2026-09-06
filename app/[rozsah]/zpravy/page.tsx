import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Stará adresa Nástěnky.
 *
 * Nástěnka se 7. 9. 2026 sloučila se Vzkazy pod jeden vchod (rozhodnutí
 * Šéfíka, `docs/nocni-prace-2026-09-07-doplneni.md`, oddíl 3) a bydlí
 * teď jako druhá záložka.
 *
 * Adresa se NERUŠÍ, jen přesměrovává. Odkaz na nástěnku už mohl někdo
 * někomu poslat nebo si ho uložit do záložek prohlížeče — a mrtvý odkaz
 * na denním nástroji je horší než o jedno přesměrování delší cesta.
 *
 * Vlastní obsah zůstal v `../vzkazy/nastenka.tsx`; akce (`./akce`) se
 * odsud dál používají, proto ten soubor nemizí.
 */
export default async function StaraNastenka({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;
  redirect(`/${rozsah}/vzkazy?zalozka=nastenka`);
}
