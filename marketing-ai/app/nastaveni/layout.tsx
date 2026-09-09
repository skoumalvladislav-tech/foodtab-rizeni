import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";

import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Nastavení organizace — rám s první viditelnou provozovnou. */
export default async function NastaveniLayout({ children }: { children: React.ReactNode }) {
  const k = await nacistKontext(null);
  if (!k.organization.onboarding_done_at) redirect("/pruvodce");
  return <Shell k={k}>{children}</Shell>;
}
