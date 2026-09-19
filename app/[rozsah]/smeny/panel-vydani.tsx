import { sklonovat } from '@/lib/sklonovani'
import { vydatRozpis } from './vydani'
import type { DataVydani } from './vydani-data'

/**
 * Panel „Vydat rozpis“ — TELEFON.
 *
 * Na počítači tuhle kartu nahrazuje kompaktní pruh nad mřížkou
 * (`desktop/vydani.tsx`); obě čtou tatáž data z `vydani-data.ts`,
 * takže se nemůžou rozejít. Karta se na počítači nekreslí (`page.tsx`).
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

const NAZVY: Record<string, string> = {
  nova: 'nová směna',
  cas: 'změna času',
  prevzata: 'nově přidělená',
  odebrana: 'odebraná',
  zrusena: 'zrušená',
}

export default function PanelVydani({
  rozsah,
  branchId,
  od,
  doKdy,
  data: dataVydani,
}: {
  rozsah: string
  branchId: string
  od: string
  doKdy: string
  data: DataVydani
}) {
  /*
    Stav období. Obrazovka musí rozeznat TŘI situace, ne dvě:

      nevydáno          nikomu nic nezvonilo, rozpis se připravuje
      vydáno beze změn  lidé vědí, co mají
      vydáno a ZMĚNĚNO  lidé vědí něco JINÉHO, než co je v rozpisu

    Ta třetí je ta, kvůli které se to píše: kdo přidá směnu do vydaného
    rozpisu, se dnes nedozvěděl, že se o ní nikdo nedozvěděl. Dřív se
    tenhle stav hlásil jako „Rozpis se ještě připravuje“, což je
    nepravda — vydaný byl.
  */
  const stav = dataVydani.stav ?? undefined

  const bylVydan = Boolean(stav?.vydano_kdy)
  const cekaZmen = stav?.zmen ?? 0

  const radky = dataVydani.nahled
  const lidi = new Set(radky.map((r) => r.user_id)).size
  const zprav = lidi // jedna zpráva na člověka, ne jedna na směnu
  const smen = radky.reduce((s, r) => s + r.pocet, 0)

  const nicSeNemeni = radky.length === 0

  // Vydáno, a přesto se od té doby něco změnilo.
  const vydanoAleZmeneno = bylVydan && cekaZmen > 0

  return (
    <section
      style={vydanoAleZmeneno ? { ...panel, borderColor: 'var(--pozor)' } : panel}
    >
      <h2 style={nadpis}>
        {vydanoAleZmeneno
          ? 'Rozpis je vydaný, ale tahle změna se k lidem nedostala'
          : bylVydan
            ? 'Rozpis je vydaný'
            : 'Rozpis se ještě připravuje'}
      </h2>

      {vydanoAleZmeneno ? (
        <p style={{ ...popis, color: 'var(--pozor)' }}>
          Od vydání {cekaZmen === 1 ? 'přibyla nebo se změnila jedna směna' : `se změnilo ${cekaZmen} směn`}.
          Lidé pořád vidí tu podobu, která se vydala naposledy — dokud
          rozpis nevydáte znovu, o změně se nedozvědí.
        </p>
      ) : null}

      {nicSeNemeni && !vydanoAleZmeneno ? (
        <p style={popis}>
          {bylVydan
            ? 'Od posledního vydání se v tomhle období nic nezměnilo. Vydat ho znovu jde, ale nikomu by nic nepřišlo.'
            : 'V tomhle období zatím není co rozeslat.'}
        </p>
      ) : nicSeNemeni ? null : (
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
          className={
            nicSeNemeni && !vydanoAleZmeneno
              ? 'ft-tl ft-tl-vedlejsi'
              : 'ft-tl ft-tl-hlavni'
          }
        >
          {nicSeNemeni
            ? 'Vydat znovu'
            : `Vydat rozpis a rozeslat ${zprav}`}
        </button>
      </form>
    </section>
  )
}

const panel = {
  margin: '0 16px 16px',
  padding: '16px 18px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
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
