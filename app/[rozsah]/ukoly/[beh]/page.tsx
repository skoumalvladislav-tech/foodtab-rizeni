import { redirect } from "next/navigation";

/**
 * Stará adresa detailu checklistu (do 23. 9.). Vedou na ni odkazy ze
 * starších upozornění a úkolů — přesměruje se na novou obrazovku.
 */
export default async function StaraAdresaBehu({
  params,
}: {
  params: Promise<{ rozsah: string; beh: string }>;
}) {
  const { rozsah, beh } = await params;
  redirect(`/${rozsah}/ukoly/checklisty/${encodeURIComponent(beh)}`);
}
