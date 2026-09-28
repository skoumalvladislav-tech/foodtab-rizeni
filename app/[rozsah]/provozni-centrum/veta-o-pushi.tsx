import Link from 'next/link'

import { nactiKliceVapid } from '@/lib/komunikace/web-push'
import { vetaOPushi } from '@/lib/komunikace/veta-o-pushi'

/**
 * Věta o upozornění do telefonu — pravdivá podle toho, jestli jsou na serveru
 * klíče VAPID, a podle toho, KDO ji čte (27. 9.).
 *
 * Věta o telefonu, která není pravda, je horší než žádná: člověk by na ni
 * spoléhal a zprávu by si nepřišel přečíst. Do 27. 9. tu všem stálo
 * „chodí jen během směny“ — jenže majiteli chodí kdykoli (rozhodnutí
 * 22. 9.) a naléhavé zprávy komukoli i mimo směnu. Samotné znění je
 * v `lib/komunikace/veta-o-pushi.ts` (s testem).
 */
export default function VetaOPushi({ rozsah, jeMajitel = false }: { rozsah: string; jeMajitel?: boolean }) {
  const veta = vetaOPushi({ pushNastaveny: nactiKliceVapid(process.env) !== null, jeMajitel })
  if (!veta.odkaz) return <>{veta.text}</>
  return (
    <>
      {veta.text} Zapnete si je v{' '}
      <Link href={`/${rozsah}/upozorneni/nastaveni`}>Nastavení upozornění</Link>.
    </>
  )
}
