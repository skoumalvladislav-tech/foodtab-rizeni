import { datumACasSRokemVPasmu } from '@/lib/cas'

import { PanelHlava } from '../../../../dnes/prvky'
import { zrusit } from '../akce'
import FormularAkce from './formular-akce'
import { popisUdalosti, shrnutiUdalosti } from './logika'
import { PoleDuvodu, Vysvetleni } from './prvky'

export type UdalostHistorie = { id: string; kdy: string; kdo: string | null; udalost: string; detail: Record<string, unknown> | null }

/** Sekce (f) Historie — nejnovější nahoře, nejvýš 50 (jine_platby_historie, jen přidávat). */
export function SekceHistorie({
  udalosti,
  jmena,
  zona,
  mena,
}: {
  udalosti: UdalostHistorie[]
  jmena: Record<string, string>
  zona: string
  mena: string | null
}) {
  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '12px', minWidth: 0 }}>
      <PanelHlava ikona="hodiny" nadpis="Historie" />
      {udalosti.length === 0 ? (
        <Vysvetleni>Zatím žádné události.</Vysvetleni>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
          {udalosti.map((u) => {
            const shrnuti = shrnutiUdalosti(u.detail, mena)
            return (
              <li key={u.id} style={{ fontSize: '14px', borderTop: '1px solid var(--line)', paddingTop: '8px', overflowWrap: 'anywhere' }}>
                <strong>{popisUdalosti(u.udalost)}</strong>
                {shrnuti ? <span> — {shrnuti}</span> : null}
                <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)' }}>
                  {datumACasSRokemVPasmu(u.kdy, zona)} · {u.kdo ? (jmena[u.kdo] ?? 'kolega') : 'systém'}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {udalosti.length >= 50 ? <Vysvetleni>Zobrazeno posledních 50 událostí.</Vysvetleni> : null}
    </section>
  )
}

/** Zrušení záznamu — jen dokud nic neproběhlo (databáze to hlídá); nevratné, proto dvoukrokové. */
export function SekceZruseni({ zakl }: { zakl: { zaznam: string; verze: number; rozsah: string } }) {
  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '12px', minWidth: 0 }}>
      <PanelHlava ikona="kos" nadpis="Zrušit záznam" />
      <FormularAkce
        akce={zrusit}
        {...zakl}
        tlacitko="Zrušit záznam"
        vzhled="nebezpecne"
        potvrzeni={{ text: 'Zrušený záznam už nejde upravovat ani obnovit. Zůstane v historii a nic se z něj nezapočítá. Opravdu zrušit?', ano: 'Ano, zrušit záznam' }}
      >
        <Vysvetleni>
          Zrušit jde jen záznam bez zapsané tržby, bez propojené faktury, bez napárované úhrady (nejdřív ji odpojte) a bez zahájeného výdeje —
          schválený výdej (i ten předaný k ručnímu odpisu) uvolní jen „Zrušit schválení“ v části Sklad.
        </Vysvetleni>
        <PoleDuvodu />
      </FormularAkce>
    </section>
  )
}
