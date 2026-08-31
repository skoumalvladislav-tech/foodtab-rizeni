import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { vydatRozpis } from './vydani'

/**
 * Panel „Vydat rozpis“.
 *
 * Zadání docs/upozorneni-smeny-zadani.md, oddíly 1 a 3. Rozpis má dva
 * stavy: rozpracovaný a vydaný. Rozpracovaný nikomu nezvoní — vedoucí
 * si ho může půl hodiny přehazovat. Vydání je závazek a rozešle zprávy.
 *
 * Náhled je tu proto, že zprávy se nedají vzít zpět. Kdo vydává rozpis
 * na měsíc dopředu, má napřed vidět, kolika lidem to zazvoní.
 *
 * Kreslí se jen na pobočce a jen tomu, kdo smí plánovat směny. Vydávat
 * rozpis „za celou firmu“ nedává smysl: upozornění se vážou na pobočku
 * a člověk může dělat na dvou.
 */

type RadekNahledu = {
  user_id: string
  jmeno: string
  zmena: string
  pocet: number
}

const NAZVY: Record<string, string> = {
  nova: 'nová směna',
  cas: 'změna času',
  prevzata: 'nově přidělená',
  odebrana: 'odebraná',
  zrusena: 'zrušená',
}

export default async function PanelVydani({
  rozsah,
  tenantId,
  branchId,
  od,
  doKdy,
}: {
  rozsah: string
  tenantId: string
  branchId: string
  od: string
  doKdy: string
}) {
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('rozpis_nahled', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_od: od,
    p_do: doKdy,
  })

  // Migrace 20260901130000 ještě nemusí být nasazená. Panel se pak
  // prostě nekreslí — rozpis kvůli tomu padat nebude.
  if (funkceNeexistuje(error)) return null
  if (error) return null

  const radky = (data ?? []) as RadekNahledu[]
  const lidi = new Set(radky.map((r) => r.user_id)).size
  const zprav = lidi // jedna zpráva na člověka, ne jedna na směnu
  const smen = radky.reduce((s, r) => s + r.pocet, 0)

  const nicSeNemeni = radky.length === 0

  return (
    <section style={panel}>
      <h2 style={nadpis}>
        {nicSeNemeni ? 'Rozpis je vydaný' : 'Rozpis se ještě připravuje'}
      </h2>

      {nicSeNemeni ? (
        <p style={popis}>
          Od posledního vydání se v tomhle období nic nezměnilo. Vydat ho
          znovu jde, ale nikomu by nic nepřišlo.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontSize: '15px' }}>
            Odejde <strong>{zprav}</strong> {sklonovat(zprav, 'zpráva', 'zprávy', 'zpráv')}{' '}
            <strong>{lidi}</strong> {sklonovat(lidi, 'člověku', 'lidem', 'lidem')}.
            Dotčeno {smen} {sklonovat(smen, 'směna', 'směny', 'směn')}.
          </p>
          <ul style={seznam}>
            {[...new Set(radky.map((r) => r.jmeno))].sort().map((jmeno) => (
              <li key={jmeno} style={{ fontSize: '13.5px' }}>
                <strong>{jmeno}</strong>{' '}
                <span style={{ color: 'var(--muted)' }}>
                  {radky
                    .filter((r) => r.jmeno === jmeno)
                    .map((r) => `${r.pocet}× ${NAZVY[r.zmena] ?? r.zmena}`)
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p style={popis}>
            Zprávy se nedají vzít zpět. Každý dostane jednu zprávu jen se
            svými směnami — o cizích se z ní nedozví. Vám samotným nepřijde
            nic, o svých změnách víte.
          </p>
        </>
      )}

      <form action={vydatRozpis}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="pobocka" value={branchId} />
        <input type="hidden" name="od" value={od} />
        <input type="hidden" name="do" value={doKdy} />
        <button
          type="submit"
          className={nicSeNemeni ? 'ft-tl ft-tl-vedlejsi' : 'ft-tl ft-tl-hlavni'}
        >
          {nicSeNemeni ? 'Vydat znovu' : `Vydat rozpis a rozeslat ${zprav}`}
        </button>
      </form>
    </section>
  )
}

/** 1 zpráva, 2–4 zprávy, 5 a víc zpráv. */
function sklonovat(n: number, jedna: string, dve: string, pet: string): string {
  if (n === 1) return jedna
  if (n >= 2 && n <= 4) return dve
  return pet
}

const panel = {
  margin: '0 16px 16px',
  padding: '16px 18px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '8px 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '66ch',
} as const

const seznam = {
  listStyle: 'none',
  margin: '0 0 4px',
  padding: 0,
  display: 'grid',
  gap: '4px',
} as const
