import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** Zástupný průvodce — plná verze přibude v dalším kroku. */
export default async function Pruvodce() {
  const k = await nacistKontext(null);
  if (k.organization.onboarding_done_at && k.venues[0]) redirect(`/${k.venues[0].slug}/prehled`);
  return <main className="prihlaseni"><div className="karta"><h1>Průvodce prvním nastavením</h1></div></main>;
}
