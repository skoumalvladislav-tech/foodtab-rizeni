import ChecklistyStranka, { type Hledani } from "../../../stranka";

export const dynamic = "force-dynamic";

/** Checklisty — detail položky (na telefonu jen položka, na počítači seznam + běh + položka). */
export default async function DetailPolozkyStranka({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; beh: string; polozka: string }>;
  searchParams: Promise<Hledani>;
}) {
  const { rozsah, beh, polozka } = await params;
  return <ChecklistyStranka rozsah={rozsah} behId={beh} polozkaId={polozka} hledani={await searchParams} />;
}
