import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Vydání vlastních údajů souborem.
 *
 * Zadání docs/osobni-udaje-zadani.md, oddíl 6: aplikace musí umět
 * odpovědět „co o mně máte“, aniž by to znamenalo ruční hrabání
 * v databázi.
 *
 * Vydává se JEN to, co patří přihlášenému. Nikde se nebere id
 * z požadavku — kdyby šlo poslat cizí, byl by z práva na výpis nástroj
 * na cizí údaje.
 *
 * Docházka a mzdy tu zatím nejsou: obojí má vlastní průzory s vlastními
 * pravidly a vejde se to sem, až se doplní. Radši neúplný výpis, o kterém
 * se ví, než úplný, o kterém si to jen myslíme — proto to soubor sám
 * říká v poli `neuplne`.
 */
export async function GET() {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return new Response('Účet nepatří k žádné firmě.', { status: 404 })

  const user = await getUser()
  if (!user) return new Response('Nejste přihlášeni.', { status: 401 })

  const ctx = await getContext(tenantId)
  if (!ctx) return new Response('Firmu se nepodařilo načíst.', { status: 404 })

  const supabase = await getServerSupabase()

  const [kontakty, souhlasy, vedomi] = await Promise.all([
    supabase.rpc('employee_contacts', { p_tenant: tenantId }),
    supabase
      .from('consents')
      .select('kind, granted, updated_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id),
    supabase
      .from('privacy_acknowledgements')
      .select('acknowledged_at, privacy_notices(verze)')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id),
  ])

  const muj =
    ((kontakty.data ?? []) as { duvod: string; full_name: string; phone: string | null; email: string | null }[])
      .find((k) => k.duvod === 'moje') ?? null

  const vypis = {
    vydano: new Date().toISOString(),
    firma: ctx.tenant.name,
    ucet: { id: user.id, email: user.email, telefon: user.phone },
    zamestnanec: muj
      ? { jmeno: muj.full_name, telefon: muj.phone, email: muj.email }
      : null,
    opravneni: ctx.role.label,
    souhlasy: souhlasy.data ?? [],
    vzato_na_vedomi: vedomi.data ?? [],
    neuplne: [
      'Docházka a odpracované hodiny — vedou se, ale do tohohle výpisu se '
        + 'zatím nedostanou.',
      'Mzdová sazba a výdělky — totéž.',
    ],
  }

  const nazev = `foodtab-moje-udaje-${new Date().toISOString().slice(0, 10)}.json`

  return new Response(JSON.stringify(vypis, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${nazev}"`,
      // Osobní údaje se nemají povalovat v mezipaměti.
      'cache-control': 'no-store',
    },
  })
}
