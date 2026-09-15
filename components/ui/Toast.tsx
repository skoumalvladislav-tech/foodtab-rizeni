"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Ton = "info" | "success" | "error";
type ZapisZpravy = { id: string; text: string; tone: Ton };

type KontextToast = { poslat: (text: string, tone?: Ton) => void };

const Kontext = createContext<KontextToast | null>(null);

/**
 * Obal kolem appky (jednou, v app/layout.tsx) — drží frontu zpráv a
 * kreslí je do portálu mimo strom appky. Appka do teď žádný sdílený
 * toast neměla (jen jeden ruční v finance/faktury/schvaleni/page.tsx).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [zpravy, setZpravy] = useState<ZapisZpravy[]>([]);
  // Server i první klientské (hydratační) vykreslení musí dopadnout
  // stejně — `typeof document` se na klientu liší od serveru už od
  // prvního průchodu, ne až po efektu, a portál by tak hydrataci
  // rozbil. `mounted` je false na obou stranách, dokud effect neproběhne.
  const [mounted, setMounted] = useState(false);

  // Sem patří schválně — cílem JE odložit setState až za hydrataci,
  // ne synchronizovat s vnějším systémem. Bez tohohle efektu by server
  // a klientovo první (hydratační) vykreslení nešly sladit vůbec.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const poslat = useCallback((text: string, tone: Ton = "info") => {
    const id = Math.random().toString(36).slice(2);
    setZpravy((z) => [...z, { id, text, tone }]);
    setTimeout(() => setZpravy((z) => z.filter((p) => p.id !== id)), 5000);
  }, []);

  return (
    <Kontext.Provider value={{ poslat }}>
      {children}
      {mounted
        ? createPortal(
            <div className="ds-toast-region" aria-live="polite" aria-atomic="false">
              {zpravy.map((z) => (
                <div key={z.id} className="ds-toast" data-tone={z.tone}>
                  <span>{z.text}</span>
                  <button
                    type="button"
                    className="ds-toast-close"
                    aria-label="Zavřít"
                    onClick={() => setZpravy((zs) => zs.filter((p) => p.id !== z.id))}
                  >
                    <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true" style={{ width: "14px", height: "14px" }}>
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </Kontext.Provider>
  );
}

/** `const { poslat } = useToast(); poslat("Uloženo.", "success");` */
export function useToast(): KontextToast {
  const ctx = useContext(Kontext);
  if (!ctx) throw new Error("useToast se smí volat jen uvnitř <ToastProvider>.");
  return ctx;
}
