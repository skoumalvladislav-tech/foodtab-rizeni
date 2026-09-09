import { notFound } from "next/navigation";

import { nacistKontext } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Hlasky } from "../../../../ui";
import { vybratUctyAkce } from "./akce";

export const dynamic = "force-dynamic";

/** Krok po OAuth: výběr Facebook Page a Instagram účtu pro každou provozovnu. Ukazují se jen účty, ke kterým má přihlášený člověk oprávnění. */
export default async function MetaVyber({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(null);
  const c = await withUser(k.session.userId, (tx) => tx.one<{ id: string; status: string; external_account: { accounts?: { platform: string; kind: string; externalId: string; name: string; username?: string }[] }; granted_scopes: string[] }>(
    "select id, status, external_account, granted_scopes from marketing.integration_connections where id = $1 and provider_key = 'meta_graph' and organization_id = $2", [id, k.organization.id]));
  if (!c) notFound();
  const accounts = c.external_account.accounts ?? [];
  const chybi = ["pages_manage_posts", "instagram_content_publish"].filter((s) => !c.granted_scopes.includes(s));
  return (
    <>
      <div className="hlavicka"><div><h1>Vyberte stránky a účty</h1><p>Pro každou provozovnu vyberte Facebook Page a profesionální Instagram účet. Zobrazují se jen ty, ke kterým máte oprávnění.</p></div></div>
      <Hlasky sp={sp} />
      {chybi.length > 0 && <div className="hlaska hlaska-pozor">Chybí udělená oprávnění: {chybi.join(", ")}. Publikace na dotčenou síť nebude fungovat, dokud je neudělíte (App Review / znovu připojit).</div>}
      {accounts.length === 0 && <div className="hlaska hlaska-bad">Meta nevrátilo žádnou stránku. Ověřte, že máte roli u Facebook Page a že je k ní připojený profesionální Instagram účet.</div>}
      <form action={vybratUctyAkce} className="karta">
        <input type="hidden" name="connectionId" value={c.id} />
        {k.venues.map((v) => (
          <div key={v.id} className="radek radek-2" style={{ marginBottom: 14 }}>
            <div className="pole"><label>{v.name} — Facebook Page</label><select name={`fb_${v.id}`} defaultValue=""><option value="">— nepublikovat —</option>{accounts.filter((a) => a.platform === "facebook").map((a) => <option key={a.externalId} value={a.externalId}>{a.name}</option>)}</select></div>
            <div className="pole"><label>{v.name} — Instagram</label><select name={`ig_${v.id}`} defaultValue=""><option value="">— nepublikovat —</option>{accounts.filter((a) => a.platform === "instagram").map((a) => <option key={a.externalId} value={a.externalId}>{a.name}{a.username ? ` (@${a.username})` : ""}</option>)}</select></div>
          </div>
        ))}
        <button className="btn btn-primary">Uložit a provést nepublikační test</button>
      </form>
    </>
  );
}
