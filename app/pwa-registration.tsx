"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export default function PwaRegistration() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && isStandalone());

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    const openInstall = () => {
      if (installed) return;
      const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (installPrompt) {
        void installPrompt.prompt().then(() => installPrompt.userChoice).then((choice) => {
          if (choice.outcome === "accepted") setInstallPrompt(null);
        });
      } else if (isiOS) {
        setShowIosHelp(true);
      }
    };
    window.addEventListener("foodtab-install", openInstall);
    return () => window.removeEventListener("foodtab-install", openInstall);
  }, [installPrompt, installed]);

  if (!showIosHelp) return null;

  return (
    <div className="install-help" role="dialog" aria-modal="true" aria-label="Instalace Foodtab na iPhone">
      <button className="install-help-scrim" onClick={() => setShowIosHelp(false)} aria-label="Zavřít návod" />
      <section>
        <span className="install-app-icon">F</span>
        <div>
          <small>INSTALACE NA IPHONE NEBO IPAD</small>
          <h2>Přidejte Foodtab na plochu</h2>
          <ol>
            <li>V Safari klepněte na tlačítko <b>Sdílet</b>.</li>
            <li>Zvolte <b>Přidat na plochu</b>.</li>
            <li>Potvrďte tlačítkem <b>Přidat</b>.</li>
          </ol>
          <button className="ft-tl ft-tl-hlavni" onClick={() => setShowIosHelp(false)}>Rozumím</button>
        </div>
      </section>
    </div>
  );
}
