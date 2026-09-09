import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** Rozcestník: první viditelná provozovna, nebo průvodce, když organizace ještě není nastavená. */
export default async function Koren() {
  const k = await nacistKontext(null);
  if (!k.organization.onboarding_done_at) redirect("/pruvodce");
  const v = k.venues[0];
  if (!v) redirect("/bez-organizace");
  redirect(`/${v.slug}/prehled`);
}
