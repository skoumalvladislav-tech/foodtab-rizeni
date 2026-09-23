import { redirect } from 'next/navigation'

/**
 * Vchod sloučené položky „Vzkazy a úkoly“ (22. 9.).
 *
 * NIC SE NEPŘESOUVÁ — obrazovky zůstávají na /vzkazy a /ukoly, tahle
 * stránka jen přesměruje na první z nich (Komunikace). Úkoly a
 * checklisty jsou odtud jednu záložku daleko (PcZalozky).
 */
export default async function VzkazyAUkoly({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params
  redirect(`/${rozsah}/vzkazy`)
}
