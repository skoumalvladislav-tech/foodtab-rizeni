import 'server-only'

import { headers } from 'next/headers'

/**
 * Absolutní adresa nasazené appky — pro návrat od CIZÍHO serveru
 * (přihlášení do pokladny) a pro adresu příjmového API, kterou si
 * integrátor vloží do pokladny.
 *
 * Stejné pravidlo jako `zakladniAdresa` v `finance/integrace/banka/akce.ts`
 * a `nastaveni/lide/akce.ts` (tam zdvojené schválně — soubor
 * `'use server'` nesmí vyvážet nic, co není akce). `NEXT_PUBLIC_APP_URL`
 * na Vercelu dnes NENÍ (a bez pokynu se nenastavuje) — adresa se pak
 * vezme z hlaviček požadavku, což na Vercelu dává skutečnou doménu.
 */
export async function zakladniAdresaAplikace(): Promise<string> {
  const nastavena = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (nastavena) return nastavena.replace(/\/+$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const protokol = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${protokol}://${host}`
}
