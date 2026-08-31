import Link from 'next/link'

import { getUser } from '@/lib/authz'
import { tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Pruh s informací o zpracování osobních údajů.
 *
 * Zadání docs/osobni-udaje-zadani.md, oddíl 2: při prvním přihlášení
 * a po každé změně verze se má informace ZOBRAZIT. Ne vynutit.
 *
 * Proto pruh, ne dialog přes celou obrazovku. Zadání říká výslovně, že
 * to přihlášení nesmí blokovat natrvalo: kdo neklikne, uvidí pruh zase
 * příště a nikomu se tím nebere přístup k docházce — ta na jeho vůli
 * nestojí.
 *
 * Kreslí se, dokud pro NEJNOVĚJŠÍ verzi chybí záznam. Verze je celý
 * smysl věci: až se text změní, pruh se objeví znovu i tomu, kdo
 * předchozí verzi vzal na vědomí.
 */
export default async function PruhInformace({
  rozsah,
  tenantId,
}: {
  rozsah: string
  tenantId: string
}) {
  const user = await getUser()
  if (!user) return null

  const supabase = await getServerSupabase()

  const { data: notices, error: chybaNotices } = await supabase
    .from('privacy_notices')
    .select('id, verze, je_zastupny')
    .eq('tenant_id', tenantId)
    .order('verze', { ascending: false })
    .limit(1)

  // Dokud neproběhla migrace 20260901120000, tabulka neexistuje. Pruh
  // se prostě nekreslí — rám aplikace kvůli tomu padat nebude.
  if (tabulkaNeexistuje(chybaNotices)) return null
  if (chybaNotices) return null

  const info = (notices ?? [])[0] as
    | { id: string; verze: number; je_zastupny: boolean }
    | undefined
  if (!info) return null

  const { data: vzato } = await supabase
    .from('privacy_acknowledgements')
    .select('notice_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('notice_id', info.id)
    .limit(1)

  if ((vzato ?? []).length > 0) return null

  return (
    <div style={pruh} role="status">
      <span style={{ minWidth: 0 }}>
        <strong>Informace o zpracování osobních údajů</strong>
        <span style={{ display: 'block', fontSize: '13px', marginTop: '2px' }}>
          {info.je_zastupny
            ? 'Text zatím není hotový — čeká na právníka. Podívat se na něj ale můžete už teď.'
            : 'Přečtěte si, co o vás firma vede a proč. Nic se tím nepodepisuje.'}
        </span>
      </span>
      <Link href={`/${rozsah}/moje-udaje#informace`} className="ft-tl ft-tl-hlavni ft-tl-male">
        Zobrazit
      </Link>
    </div>
  )
}

const pruh = {
  display: 'flex',
  gap: '14px',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap' as const,
  margin: '16px 16px 0',
  padding: '12px 14px',
  border: '1px solid var(--mosaz)',
  borderRadius: '12px',
  background: 'var(--card)',
  color: 'var(--ink)',
  fontSize: '14px',
} as const
