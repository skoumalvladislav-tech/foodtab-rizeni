import { odkazDoFoodtabu } from "@/lib/auth/kam";
import type { Kontext } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Navigace } from "./[provozovna]/navigace";
import { PrepinacProvozovny } from "./[provozovna]/prepinac";
import { odhlasit } from "./prihlaseni/akce";

/**
 * Společný rám: horní lišta s přepínačem provozovny, levý sloupec,
 * spodní lišta na mobilu. Používá ho layout provozovny i nastavení
 * organizace (tam se drží první viditelná provozovna).
 */
export async function Shell({ k, children }: { k: Kontext; children: React.ReactNode }) {
  const venue = k.venue ?? k.venues[0];
  const cekajici = venue && (k.isOwner || k.permissions.has("content.approve"))
    ? await withUser(k.session.userId, async (tx) => {
        const r = await tx.one<{ n: number }>("select count(*)::int as n from marketing.approval_requests where venue_id = $1 and status = 'pending'", [venue.id]);
        return r?.n ?? 0;
      })
    : 0;
  const neprectene = await withUser(k.session.userId, async (tx) => {
    const r = await tx.one<{ n: number }>("select count(*)::int as n from marketing.notifications where user_id = $1 and read_at is null", [k.session.userId]);
    return r?.n ?? 0;
  });
  const foodtab = odkazDoFoodtabu("/firma");
  return (
    <div className="shell" data-venue={venue?.color ?? "slate"}>
      <header className="topbar">
        <a className="brand" href={venue ? `/${venue.slug}/prehled` : "/"}>
          Food<em>Tab</em> <small>Marketing AI</small>
        </a>
        {venue && <PrepinacProvozovny venues={k.venues} current={venue.slug} />}
        <span className="topbar-spacer" />
        {foodtab && <a className="tiche" href={foodtab}>← FoodTab Řízení</a>}
        <a className="tiche" href="/upozorneni" title="Upozornění">🔔{neprectene > 0 ? ` ${neprectene}` : ""}</a>
        <span className="uzivatel">
          <b>{k.session.name}</b> · {k.roleName}
          {k.session.mode === "demo" && <> · <span className="stitek stitek-mock">demo</span></>}
        </span>
        <form action={odhlasit}>
          <button className="btn btn-male" type="submit">Odhlásit</button>
        </form>
      </header>
      <div className="telo">
        {venue && <Navigace slug={venue.slug} cekajici={cekajici} opravneni={[...k.permissions]} isOwner={k.isOwner} />}
        <main className="obsah">{children}</main>
      </div>
    </div>
  );
}
