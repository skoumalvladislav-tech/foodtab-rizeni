import ChecklistyStranka, { type Hledani } from "./stranka";

export const dynamic = "force-dynamic";

/** Checklisty — seznam (na telefonu jen seznam, na počítači seznam + „vyberte"). */
export default async function Checklisty({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>;
  searchParams: Promise<Hledani>;
}) {
  const { rozsah } = await params;
  return <ChecklistyStranka rozsah={rozsah} behId={null} polozkaId={null} hledani={await searchParams} />;
}
