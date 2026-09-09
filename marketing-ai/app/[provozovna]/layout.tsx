import { redirect } from "next/navigation";

import { odkazDoFoodtabu } from "@/lib/auth/kam";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Navigace } from "./navigace";
import { PrepinacProvozovny } from "./prepinac";
import { odhlasit } from "../prihlaseni/akce";

export const dynamic = "force-dynamic";

export default async function ProvozovnaLayout({ children, params }: { children: React.ReactNode; params: Promise<{ provozovna: string }> }) {
  const { provozovna } = await params;
  const k = await nacistKontext(provozovna);
  if (!k.venue) redirect("/");
  if (!k.organization.onboarding_done_at) redirect("/pruvodce");

  const cekajici = muze(k, "content.approve")
    ? await withUser(k.session.userId, async (tx) => {
        const r = await tx.one<{ n: number }>(
          "select count(*)::int as n from marketing.approval_requests where venue_id = $1 and status = 'pending'",
          [k.venue!.id],
        );
        return r?.n ?? 0;
      })
    : 0;

  const foodtab = odkazDoFoodtabu("/firma");

  return (
    <div className="shell" data-venue={k.venue.color}>
      <header className="topbar">
        <a className="brand" href={`/${k.venue.slug}/prehled`}>
          Food<em>Tab</em> <small>Marketing AI</small>
        </a>
        <PrepinacProvozovny venues={k.venues} current={k.venue.slug} />
        <span className="topbar-spacer" />
        {foodtab && (
          <a className="tiche" href={foodtab}>← FoodTab Řízení</a>
        )}
        <span className="uzivatel">
          <b>{k.session.name}</b> · {k.roleName}
          {k.session.mode === "demo" && <> · <span className="stitek stitek-mock">demo</span></>}
        </span>
        <form action={odhlasit}>
          <button className="btn btn-male" type="submit">Odhlásit</button>
        </form>
      </header>
      <div className="telo">
        <Navigace slug={k.venue.slug} cekajici={cekajici} opravneni={[...k.permissions]} isOwner={k.isOwner} />
        <main className="obsah">{children}</main>
      </div>
    </div>
  );
}
