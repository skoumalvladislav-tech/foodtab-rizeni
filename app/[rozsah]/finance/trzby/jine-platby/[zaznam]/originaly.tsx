import { velikostText } from '@/lib/jine-platby-soubory'

import { PanelHlava } from '../../../../dnes/prvky'
import Ikona from '../../../../ikona'
import { PevnyObrazek } from '../../../../vzkazy/[konverzace]/pevny-zdroj'
import NahratDoklad from '../nahrat-doklad'
import styly from './detail.module.css'
import { Vysvetleni } from './prvky'

/**
 * Levý sloupec detailu: originály dokladu a nahrání dalších stránek.
 *
 * Obrázek i PDF jdou přes `/api/jine-platby/soubor/<id>` (právo + RLS
 * + podepsaný odkaz na 120 s, docs/jine-platby-navrh.md oddíl 6) — nikdy
 * přímý odkaz do úložiště. `PevnyObrazek` drží zdroj z prvního vykreslení,
 * takže živá obnova stránky fotku nestahuje znovu.
 */
export default function Originaly({
  soubory,
  nahrani,
}: {
  soubory: { id: string; poradi: number; mime: string; velikost: number }[]
  nahrani: { rozsah: string; tenantId: string; branchId: string; zaznamId: string; uzMa: number; smi: boolean }
}) {
  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '12px' }}>
      <PanelHlava ikona="fotka" nadpis="Originály dokladu" />
      {soubory.length === 0 ? (
        <Vysvetleni>Zatím žádný doklad. Vyfoťte sjetinu nebo účet, nahrajte PDF — nebo zadejte položky ručně vpravo.</Vysvetleni>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '14px' }}>
          {soubory.map((s) => {
            const adresa = `/api/jine-platby/soubor/${s.id}`
            const pdf = s.mime === 'application/pdf'
            return (
              <li key={s.id} style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
                {pdf ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' }}>
                    <Ikona klic="faktura" />
                    <span style={{ fontSize: '14px' }}>
                      PDF, stránka {s.poradi} ({velikostText(s.velikost)})
                    </span>
                  </div>
                ) : (
                  <div className={styly.original}>
                    <PevnyObrazek src={adresa} alt={`Doklad, stránka ${s.poradi}`} />
                  </div>
                )}
                <a href={adresa} target="_blank" rel="noopener noreferrer" className="ft-tl ft-tl-vedlejsi" style={{ justifySelf: 'start' }}>
                  Otevřít originál {s.poradi}
                </a>
              </li>
            )
          })}
        </ol>
      )}
      <NahratDoklad {...nahrani} />
      <Vysvetleni>Nahrání fotky ani rozpoznání nic nezapisuje do tržeb ani do skladu.</Vysvetleni>
    </section>
  )
}
