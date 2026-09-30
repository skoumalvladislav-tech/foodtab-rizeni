import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/**
 * Odběr změn přes Supabase Realtime — kanál se připojí AŽ S PŘIHLÁŠENÍM.
 *
 * PROČ NE ROVNOU `.channel(...).subscribe()`. Zpráva o připojení kanálu
 * (`phx_join`) se sestaví v tu chvíli, kdy se `subscribe()` zavolá, a čeká
 * ve frontě, než se otevře websocket. Token do ní dá klient jen tehdy, když
 * ho už má. Čerstvý klient (první `getBrowserSupabase()` po načtení stránky)
 * ho ještě nemá: sezení z cookie si auth přečte až asynchronně. Kanál se tak
 * připojil bez tokenu, Realtime vzal místo něj veřejný klíč (role `anon`)
 * a odběr zamítl — `anon` na `notifications` ani na checklisty nemá SELECT,
 * takže `realtime.subscription_check_filters` hlásí „invalid column for
 * filter user_id“ (v ostré databázi od 24. 9. 2026 po každém načtení).
 *
 * Token, který auth přečte o chvilku později, se na server nedostal:
 * kanál ještě nebyl připojený, takže ho klient neposlal, a po připojení
 * už ho měl za „stejný“ a neposlal ho znovu. Kanál zůstal bez přihlášení
 * až do obnovy tokenu (klidně hodinu) nebo do znovupřipojení websocketu —
 * do té doby nic nedoručil.
 *
 * Proto: nejdřív sezení, pak `realtime.setAuth(token)`, teprve pak
 * `subscribe()`. Bez sezení se kanál nepřipojuje vůbec — jako `anon` by
 * stejně nic nedostal, jen by v logu přibyla chyba.
 *
 * OBNOVA TOKENU se tu neřeší a nemá: supabase-js sám poslouchá
 * `onAuthStateChange` a při TOKEN_REFRESHED / SIGNED_IN volá
 * `realtime.setAuth` — připojeným kanálům nový token pošle a do zprávy
 * o připojení ho zapíše pro případné znovupřipojení. Selhávalo jen to
 * první připojení.
 *
 * Vrací úklid pro návrat z `useEffect`. Když ho komponenta zavolá dřív,
 * než se sezení načetlo (odchod ze stránky), kanál vůbec nevznikne.
 */
export function odebiratZmeny(
  supabase: SupabaseClient,
  nazev: string,
  naslouchat: (kanal: RealtimeChannel) => RealtimeChannel,
): () => void {
  let konec = false
  let kanal: RealtimeChannel | null = null

  void (async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token || konec) return
    await supabase.realtime.setAuth(token)
    if (konec) return
    kanal = naslouchat(supabase.channel(nazev)).subscribe()
  })().catch(() => {
    // Výpadek přihlášení nebo websocketů: jede se bez živé aktualizace,
    // obrazovky se obnovují po akci a po navigaci jako dřív.
  })

  return () => {
    konec = true
    if (kanal) void supabase.removeChannel(kanal)
  }
}
