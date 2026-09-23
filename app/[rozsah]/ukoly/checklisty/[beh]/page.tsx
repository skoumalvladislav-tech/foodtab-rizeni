import ChecklistyStranka, { type Hledani } from "../stranka";

export const dynamic = "force-dynamic";

/** Checklisty — detail běhu (na telefonu jen detail, na počítači seznam + detail). */
export default async function DetailBehuStranka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string }>;
  searchParams: Promise<Hledani>;
}) {
  const { rozsah, beh } = await params;
  return <ChecklistyStranka rozsah={rozsah} behId={beh} polozkaId={null} hledani={await searchParams} />;
}
