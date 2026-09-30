"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabase } from "@/lib/supabase/client";
import { odebiratZmeny } from "@/lib/supabase/zive";

/**
 * Živá aktualizace — nová zpráva, oznámení nebo úkol osvěží obrazovku sama.
 *
 * ODEBÍRÁ SE JEN JEDNA TABULKA: `notifications`, a jen řádky přihlášeného
 * (`user_id = ja`). Každá nová zpráva, oznámení i přidělený úkol už
 * příjemcům upozornění vyrábí (app.notifikovat), takže tenhle jediný zdroj
 * stačí jako zvonek „něco se stalo — načti znovu“. Z `notifications` se nic
 * nečte do obrazovky (tělo má jen holé údaje) a text zpráv tudy nechodí.
 *
 * Do publikace realtime se `konverzace_zpravy` NEDÁVÁ: RLS přes definer
 * funkci `app.je_ucastnik` by se vyhodnocovala pro každého odběratele u každé
 * zprávy. Cena jedné notifikace navíc je nulová.
 *
 * KDYŽ REALTIME NENÍ (migrace 20260921120000 nenasazená, výpadek, blokované
 * websockety), nic se nestane — odběr prostě nic nedoručí a obrazovky se
 * obnovují jako dřív (po akci a po navigaci). Nic nespadne a nic se netvrdí.
 *
 * Kanál se připojuje přes `odebiratZmeny` — až s tokenem přihlášeného.
 * Rovnou `.subscribe()` se po načtení stránky připojil jako `anon`
 * a Realtime odběr zamítl (proč, viz lib/supabase/zive.ts).
 */
export default function ZivaAktualizace({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    let casovac: ReturnType<typeof setTimeout> | null = null;
    let zrusit: (() => void) | null = null;

    try {
      // Dávka: víc upozornění naráz (nová zpráva do kanálu pro celou pobočku)
      // vyvolá jedno obnovení, ne deset.
      const obnovit = () => {
        if (casovac) return;
        casovac = setTimeout(() => {
          casovac = null;
          router.refresh();
        }, 800);
      };

      zrusit = odebiratZmeny(getBrowserSupabase(), `notifikace:${userId}`, (kanal) =>
        kanal.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          obnovit,
        ),
      );
    } catch {
      // Chybí nastavení nebo prohlížeč websockety neumí: aplikace jede bez živé aktualizace.
    }

    return () => {
      if (casovac) clearTimeout(casovac);
      zrusit?.();
    };
  }, [userId, router]);

  return null;
}
