import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'

import Sdeleni from '@/app/sdeleni'
import Ikona from '../ikona'
import { oznacitPrectene } from './akce-nastenka'

/**
 * Seznam oznámení na Nástěnce — jen vykreslení (27. 9.).
 *
 * Data dodá `nastenka.tsx` (už SEŘAZENÁ funkcí `seraditOznameni`),
 * komponenta nesahá do databáze, takže se dá vykreslit i v dočasném
 * náhledu. Vzhled podle mockupu Dnes: každé oznámení je karta
 * `.ds-plocha`, stav nese štítek se slovem a ikona ze sdílené sady
 * (do 27. 9. „✓“ a barevný rámeček).
 */

export type OznameniUI = {
  id: string
  branch_id: string | null
  employee_id: string | null
  usek_id: string | null
  position_id: string | null
  body: string
  pinned: boolean
  author_id: string | null
  created_at: string
  requires_acknowledgment: boolean
}

export default function SeznamOznameni({
  rozsah,
  zpravy,
  prectene,
  proMe,
  autori,
  useky,
  pozice,
  pobocky,
  naFiremniUrovni,
  muzePsat,
  nepotvrdili,
}: {
  rozsah: string
  /** Seřazená oznámení (nepotvrzená nahoře). */
  zpravy: OznameniUI[]
  /** Id oznámení, která už mám přečtená / potvrzená. */
  prectene: string[]
  /**
   * Id oznámení určených MNĚ (`jeProMe`, 28. 9.). Jen u nich je štítek
   * „Čeká na vaše potvrzení“, tlačítko a „Přečteno“. Vlastní oznámení
   * a oznámení pro jiné úseky, pozice a lidi (vedoucímu je pustí RLS)
   * se ukážou bez nich — nečekají na mě a nepočítají se do čísla.
   */
  proMe: string[]
  /** profiles.user_id → jméno autora. */
  autori: Record<string, string>
  useky: Record<string, string>
  pozice: Record<string, string>
  pobocky: Record<string, string>
  /** Firemní úroveň: u pobočkových oznámení se píše název pobočky. */
  naFiremniUrovni: boolean
  muzePsat: boolean
  /** Id oznámení → jména těch, kdo ještě nepotvrdili (jen pro vedení). */
  nepotvrdili: Record<string, string[]>
}) {
  if (zpravy.length === 0) {
    return (
      <Sdeleni nadpis="Nástěnka je prázdná">
        {muzePsat ? 'Zatím tu nic není. Napište první oznámení.' : 'Zatím tu nic není.'}
      </Sdeleni>
    )
  }

  const precteno = new Set(prectene)
  const mne = new Set(proMe)

  return (
    <ul className="pc-oznameni-seznam">
      {zpravy.map((z) => {
        const proMeTo = mne.has(z.id)
        const jePrectena = proMeTo && precteno.has(z.id)
        const cekaNaMe = proMeTo && z.requires_acknowledgment && !jePrectena
        const firemni = z.branch_id === null

        return (
          <li
            key={z.id}
            className="ds-plocha pc-oznameni"
            data-ceka={cekaNaMe ? '1' : undefined}
            data-pripnute={z.pinned ? '1' : undefined}
            data-prectene={jePrectena ? '1' : undefined}
          >
            <p className="pc-oznameni-meta">
              {cekaNaMe ? (
                <span className="pc-oznameni-stitek" data-druh="potvrdit">
                  <Ikona klic="vykricnik" /> Čeká na vaše potvrzení
                </span>
              ) : z.pinned ? (
                <span className="pc-oznameni-stitek" data-druh="pripnuto">
                  <Ikona klic="praporek" /> Připnuto
                </span>
              ) : null}
              <span>
                {[
                  z.author_id ? autori[z.author_id] : null,
                  // Adresát: úsek/pozice mají přednost před pobočkou.
                  z.usek_id
                    ? (useky[z.usek_id] ?? 'úsek')
                    : z.position_id
                      ? (pozice[z.position_id] ?? 'pozice')
                      : z.employee_id
                        ? 'osobní'
                        : firemni
                          ? 'celá firma'
                          : naFiremniUrovni
                            ? (pobocky[z.branch_id as string] ?? 'jiná pobočka')
                            : null,
                  datumACasVPasmu(z.created_at, ZONA_VYCHOZI),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>

            <p className="pc-oznameni-text">{z.body}</p>

            {!proMeTo ? null : jePrectena ? (
              <p className="pc-oznameni-hotovo">
                <Ikona klic="fajfkaKruh" />
                {z.requires_acknowledgment ? 'Potvrzeno' : 'Přečteno'}
              </p>
            ) : (
              <form action={oznacitPrectene} style={{ marginTop: '12px' }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="zprava" value={z.id} />
                <button
                  type="submit"
                  className={z.requires_acknowledgment ? 'ft-tl ft-tl-hlavni ft-tl-male' : 'ft-tl ft-tl-vedlejsi ft-tl-male'}
                >
                  <Ikona klic="fajfka" />
                  {z.requires_acknowledgment ? 'Beru na vědomí' : 'Označit jako přečtené'}
                </button>
              </form>
            )}

            {muzePsat && z.requires_acknowledgment && nepotvrdili[z.id]?.length ? (
              <p className="pc-oznameni-nepotvrdili">Nepotvrdili: {nepotvrdili[z.id].join(', ')}</p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
