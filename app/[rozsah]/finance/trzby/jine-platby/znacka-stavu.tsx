import Badge from '@/components/ui/Badge'
import type { PopisStavu } from '@/lib/jine-platby-stav'

import Ikona from '../../../ikona'

/**
 * Stavová značka záznamu Jiných plateb (kontrola, tržba, sklad, faktura,
 * úhrada) — jedna komponenta pro přehled i detail.
 *
 * Text a tón dodá `popisStavu*` z lib/jine-platby-stav.ts. Barva nikdy
 * nenese význam sama (docs/vzhled-zadani.md, oddíl 7): text je vždycky
 * vidět a stav, který chce pozornost (`varovani`), má navíc ikonu ze
 * sdílené sady — kdo barvy nerozezná, pozná ho podle tvaru.
 *
 * Čistě kreslicí, bez háčků — jde vykreslit na serveru i v klientské
 * komponentě detailu.
 */
export default function ZnackaStavu({ popis }: { popis: PopisStavu }) {
  return (
    <Badge tone={popis.ton}>
      {popis.varovani ? <Ikona klic="varovani" velikost={13} /> : null}
      {popis.text}
    </Badge>
  )
}
