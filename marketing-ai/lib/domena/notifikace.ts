import type { Tx } from "../db/driver.ts";

/**
 * Komu poslat upozornění. Ptáme se databáze, ne názvu role:
 * schvalovatel je každý, kdo má content.approve (nebo je vlastník)
 * a vidí na provozovnu.
 */
export async function uzivateleSPravem(tx: Tx, organizationId: string, permission: string, venueId: string | null): Promise<string[]> {
  const rows = await tx.q<{ user_id: string }>(
    `select distinct m.user_id
       from marketing.memberships m
       join marketing.roles r on r.id = m.role_id
      where m.organization_id = $1 and m.status = 'active' and m.deleted_at is null
        and (r.is_owner or exists (select 1 from marketing.role_permissions rp where rp.role_id = r.id and rp.permission_key = $2))
        and ($3::uuid is null or m.scope = 'organization'
             or exists (select 1 from marketing.venue_access va where va.membership_id = m.id and va.venue_id = $3))`,
    [organizationId, permission, venueId],
  );
  return rows.map((r) => r.user_id);
}

export async function upozornit(tx: Tx, n: { organizationId: string; userIds: string[]; kind: string; title: string; body?: string; link?: string; exceptUserId?: string | null }) {
  for (const uid of new Set(n.userIds)) {
    if (n.exceptUserId && uid === n.exceptUserId) continue;
    await tx.q(
      "insert into marketing.notifications (organization_id, user_id, kind, title, body, link) values ($1, $2, $3, $4, $5, $6)",
      [n.organizationId, uid, n.kind, n.title, n.body ?? "", n.link ?? null],
    );
  }
}
