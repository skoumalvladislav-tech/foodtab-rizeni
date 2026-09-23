import { redirect } from "next/navigation";

/** Stará adresa „Nahlásit problém" (do 23. 9.) — přesměruje na novou. */
export default async function StaraAdresaProblemu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string }>;
  searchParams: Promise<{ polozka?: string }>;
}) {
  const { rozsah, beh } = await params;
  const { polozka } = await searchParams;
  const q = polozka ? `?polozka=${encodeURIComponent(polozka)}` : "";
  redirect(`/${rozsah}/ukoly/checklisty/${encodeURIComponent(beh)}/problem${q}`);
}
