import Link from 'next/link'

import { nactiKliceVapid } from '@/lib/komunikace/web-push'

/**
 * Věta o upozornění do telefonu — pravdivá podle toho, jestli jsou na serveru
 * klíče VAPID.
 *
 * Věta o telefonu, která není pravda, je horší než žádná: člověk by na ni
 * spoléhal a zprávu by si nepřišel přečíst. Proto se „zatím nechodí“ mění na
 * návod až ve chvíli, kdy je push opravdu nakonfigurovaný.
 */
export default function VetaOPushi({ rozsah }: { rozsah: string }) {
  if (nactiKliceVapid(process.env) === null) {
    return <>Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím nechodí.</>
  }
  return (
    <>
      Zprávy se ukazují v aplikaci. Upozornění do telefonu si zapnete v{' '}
      <Link href={`/${rozsah}/upozorneni/nastaveni`}>Nastavení upozornění</Link> — chodí jen během směny.
    </>
  )
}
