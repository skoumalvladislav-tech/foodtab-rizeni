import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Stará adresa Rozhovorů.
 *
 * Rozhovory se 7. 9. 2026 přejmenovaly na Vzkazy a sloučily s Nástěnkou
 * pod jeden vchod (rozhodnutí Šéfíka).
 *
 * Adresa se NERUŠÍ, jen přesměrovává — ze stejného důvodu jako
 * u nástěnky: odkaz na konkrétní obrazovku už mohl někdo někomu poslat.
 */
export default async function StareRozhovory({
  params,
}: {
  params: Promise<{ rozsah: string }>;
}) {
  const { rozsah } = await params;
  redirect(`/${rozsah}/vzkazy`);
}
