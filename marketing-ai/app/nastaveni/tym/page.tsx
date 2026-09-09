import { formatDatumCas } from "@/lib/cas";
import { isDemoMode } from "@/lib/auth/session";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";
import { DEMO_USERS } from "@/lib/demo-ucty";

import { Hlasky } from "../../ui";
import { clenAkce, roleAkce } from "./akce";

export const dynamic = "force-dynamic";

export default async function Tym({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const k = await nacistKontext(null);
  const data = await withUser(k.session.userId, async (tx) => {
    const [clenove, role, perms, rolePerms, audit] = await Promise.all([
      tx.q<{ id: string; user_id: string; name: string; role_key: string; role_name: string; scope: string; status: string; venues: string[] | null; created_at: string }>(
        `select m.id, m.user_id, p.display_name as name, r.key as role_key, r.name as role_name, m.scope, m.status, m.created_at,
                (select array_agg(v.name order by v.name) from marketing.venue_access va join marketing.venues v on v.id = va.venue_id where va.membership_id = m.id) as venues
           from marketing.memberships m join marketing.profiles p on p.user_id = m.user_id join marketing.roles r on r.id = m.role_id
          where m.organization_id = $1 and m.deleted_at is null order by r.sort_order, p.display_name`, [k.organization.id]),
      tx.q<{ id: string; key: string; name: string; description: string; is_owner: boolean }>("select id, key, name, description, is_owner from marketing.roles where organization_id = $1 order by sort_order", [k.organization.id]),
      tx.q<{ key: string; description: string }>("select key, description from marketing.permissions order by sort_order"),
      tx.q<{ role_id: string; permission_key: string }>("select rp.role_id, rp.permission_key from marketing.role_permissions rp join marketing.roles r on r.id = rp.role_id where r.organization_id = $1", [k.organization.id]),
      muze(k, "audit.read") ? tx.q<{ id: number; action: string; entity_type: string; entity_id: string | null; actor: string | null; venue: string | null; created_at: string; details: Record<string, unknown> }>(
        `select a.id, a.action, a.entity_type, a.entity_id, p.display_name as actor, v.name as venue, a.created_at, a.details
           from marketing.audit_logs a left join marketing.profiles p on p.user_id = a.actor_id left join marketing.venues v on v.id = a.venue_id
          where a.organization_id = $1 and ($2 = '' or a.entity_type = $2) order by a.created_at desc limit 100`, [k.organization.id, sp.typ ?? ""]) : Promise.resolve([]),
    ]);
    return { clenove, role, perms, rolePerms, audit };
  });
  const smi = muze(k, "team.manage");
  const demo = isDemoMode();
  const kandidati = DEMO_USERS.filter((u) => u.organizationId === k.organization.id && !data.clenove.some((c) => c.user_id === u.id));

  return (
    <>
      <div className="hlavicka"><div><h1>Tým, role a audit</h1><p>Role a oprávnění jsou data organizace. Vstup je jen na pozvánku. Členové se neodstraňují, jen pozastavují — kvůli návaznosti auditu.</p></div></div>
      <Hlasky sp={sp} />
      <section className="karta">
        <h2>Členové</h2>
        <div className="tabulka-obal"><table className="tabulka">
          <thead><tr><th>Jméno</th><th>Oprávnění (role)</th><th>Rozsah</th><th>Stav</th><th>Od</th>{smi && <th></th>}</tr></thead>
          <tbody>{data.clenove.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b>{c.user_id === k.session.userId && <span className="faint"> (vy)</span>}</td>
              <td>{smi ? <form action={clenAkce} className="btn-radek"><input type="hidden" name="membershipId" value={c.id} /><select name="roleKey" defaultValue={c.role_key}>{data.role.map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}</select>
                <select name="scope" defaultValue={c.scope}><option value="organization">celá organizace</option><option value="venues">vybrané provozovny</option></select>
                {k.venues.map((v) => <label key={v.id} className="chip"><input type="checkbox" name="venue" value={v.id} defaultChecked={(c.venues ?? []).includes(v.name)} /> {v.name}</label>)}
                <button className="btn btn-male">Uložit</button></form> : c.role_name}</td>
              <td>{c.scope === "organization" ? "celá organizace" : (c.venues ?? []).join(", ") || "žádná provozovna"}</td>
              <td>{c.status === "active" ? <span className="stitek stitek-dobre">aktivní</span> : <span className="stitek stitek-pozor">pozastaveno</span>}</td>
              <td className="faint">{formatDatumCas(new Date(c.created_at), k.tz)}</td>
              {smi && <td><form action={clenAkce}><input type="hidden" name="membershipId" value={c.id} /><input type="hidden" name="status" value={c.status === "active" ? "suspended" : "active"} /><button className="btn btn-male btn-tiche">{c.status === "active" ? "Pozastavit" : "Obnovit"}</button></form></td>}
            </tr>
          ))}</tbody>
        </table></div>
        {smi && (
          <form action={clenAkce} style={{ marginTop: 12 }}>
            <h3>Pozvat člena</h3>
            <div className="radek radek-3">
              {demo ? (
                <div className="pole"><label htmlFor="demoUser">Demo účet (v demu nejde posílat e-maily)</label><select id="demoUser" name="demoUser" required>{kandidati.length === 0 && <option value="">— všichni demo uživatelé už jsou členy —</option>}{kandidati.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></div>
              ) : (
                <div className="pole"><label htmlFor="email">Pracovní e-mail</label><input id="email" name="email" type="email" required /><small>Pozvánka přijde e-mailem s přihlašovacím kódem.</small></div>
              )}
              <div className="pole"><label htmlFor="roleKey">Oprávnění</label><select id="roleKey" name="roleKey" defaultValue="editor">{data.role.filter((r) => !r.is_owner).map((r) => <option key={r.id} value={r.key}>{r.name} — {r.description}</option>)}</select></div>
              <div className="pole"><label>Rozsah</label><select name="scope" defaultValue="venues"><option value="organization">celá organizace</option><option value="venues">vybrané provozovny</option></select><div className="chip-radek" style={{ marginTop: 6 }}>{k.venues.map((v) => <label key={v.id} className="chip"><input type="checkbox" name="venue" value={v.id} defaultChecked /> {v.name}</label>)}</div></div>
            </div>
            <button className="btn btn-primary">Pozvat</button>
          </form>
        )}
      </section>

      <section className="karta">
        <h2>Oprávnění rolí</h2>
        <p className="muted">Vlastník má vše a jeho práva nejdou omezit. Ostatní role si organizace může upravit.</p>
        <div className="tabulka-obal"><table className="tabulka male">
          <thead><tr><th>Právo</th>{data.role.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
          <tbody>{data.perms.map((p) => (
            <tr key={p.key}><td>{p.description}<div className="faint mono">{p.key}</div></td>
              {data.role.map((r) => {
                const has = r.is_owner || data.rolePerms.some((x) => x.role_id === r.id && x.permission_key === p.key);
                return <td key={r.id}>{r.is_owner || !smi ? (has ? "✓" : "—") : <form action={roleAkce}><input type="hidden" name="roleId" value={r.id} /><input type="hidden" name="permission" value={p.key} /><input type="hidden" name="grant" value={has ? "0" : "1"} /><button className="btn btn-male btn-tiche" title={has ? "odebrat" : "přidat"}>{has ? "✓" : "—"}</button></form>}</td>;
              })}</tr>
          ))}</tbody>
        </table></div>
      </section>

      {muze(k, "audit.read") && (
        <section className="karta">
          <h2>Auditní přehled</h2>
          <form method="get" className="chip-radek" style={{ marginBottom: 10 }}>
            {[["", "vše"], ["approval_decision", "schválení"], ["publish_job", "publikace"], ["integration_connection", "připojení"], ["membership", "členství"], ["role_permission", "oprávnění"], ["content_item", "obsah"]].map(([t, l]) => <a key={t} className={`chip${(sp.typ ?? "") === t ? " on" : ""}`} href={`/nastaveni/tym${t ? `?typ=${t}` : ""}#audit`}>{l}</a>)}
          </form>
          <div className="tabulka-obal" id="audit"><table className="tabulka male">
            <thead><tr><th>Kdy</th><th>Kdo</th><th>Akce</th><th>Co</th><th>Provozovna</th><th>Detail</th></tr></thead>
            <tbody>{data.audit.map((a) => (
              <tr key={a.id}><td className="faint">{formatDatumCas(new Date(a.created_at), k.tz)}</td><td>{a.actor ?? "systém"}</td><td>{a.action}</td><td>{a.entity_type} <span className="faint mono">{a.entity_id?.slice(0, 8)}</span></td><td>{a.venue ?? "—"}</td>
                <td><details><summary className="faint">zobrazit</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxWidth: 420 }}>{JSON.stringify(a.details, null, 1).slice(0, 1200)}</pre></details></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
