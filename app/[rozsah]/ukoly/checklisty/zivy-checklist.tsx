"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getBrowserSupabase } from "@/lib/supabase/client";
import { odebiratZmeny } from "@/lib/supabase/zive";

/**
 * Živý checklist — když kolega na jiném telefonu odškrtne položku, tady
 * se obrazovka obnoví sama (zadání bod 43).
 *
 * Kanál je SDÍLENÝ pro běh (`checklist:<id>`), ne pro člověka: dívá se
 * víc lidí na tentýž běh. Odebírají se jen řádky toho běhu; RLS
 * (checklist_entries_all, checklist_runs_read) rozhodne, komu je
 * Realtime vůbec pošle. Payload se nečte — jen se řekne „načti znovu"
 * (router.refresh), data přijdou normální cestou přes server.
 *
 * DELETE se neposlouchá: Realtime ho přes RLS nefiltruje, a položky se
 * nemažou (vrácení je update checked=false) — viz
 * 20260923150000_checklisty_realtime.sql.
 *
 * Bez realtime (migrace nenasazená, výpadek, blokované websockety) se
 * nic nestane — obrazovka se obnoví po akci a po navigaci jako dřív.
 *
 * Kanál se připojuje přes `odebiratZmeny` — až s tokenem přihlášeného.
 * Při načtení stránky checklistu se dřív připojil jako `anon` (v logu
 * „invalid column for filter id“, 25. 9. 2026), viz lib/supabase/zive.ts.
 */
export default function ZivyChecklist({ beh }: { beh: string }) {
  const router = useRouter();

  useEffect(() => {
    let casovac: ReturnType<typeof setTimeout> | null = null;
    let zrusit: (() => void) | null = null;

    try {
      const obnovit = () => {
        if (casovac) return;
        casovac = setTimeout(() => {
          casovac = null;
          router.refresh();
        }, 800);
      };

      zrusit = odebiratZmeny(getBrowserSupabase(), `checklist:${beh}`, (kanal) =>
        kanal
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "checklist_entries", filter: `run_id=eq.${beh}` }, obnovit)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "checklist_entries", filter: `run_id=eq.${beh}` }, obnovit)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "checklist_runs", filter: `id=eq.${beh}` }, obnovit),
      );
    } catch {
      // Bez nastavení nebo websocketů: jede se bez živé aktualizace.
    }

    return () => {
      if (casovac) clearTimeout(casovac);
      zrusit?.();
    };
  }, [beh, router]);

  return null;
}
