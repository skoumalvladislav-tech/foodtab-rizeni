"use client";

import { usePathname } from "next/navigation";

const I = {
  prehled: <svg className="ico" viewBox="0 0 24 24"><path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>,
  tvorba: <svg className="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  media: <svg className="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/></svg>,
  menu: <svg className="ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>,
  sablony: <svg className="ico" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>,
  kalendar: <svg className="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>,
  schvaleni: <svg className="ico" viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>,
  kampane: <svg className="ico" viewBox="0 0 24 24"><path d="M4 14v-4l12-5v14L4 14z"/><path d="M8 14v5"/></svg>,
  publikace: <svg className="ico" viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>,
  analytika: <svg className="ico" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>,
  integrace: <svg className="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>,
  brand: <svg className="ico" viewBox="0 0 24 24"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6L7.1 18.2l.9-5.5-4-3.9L9.5 8z"/></svg>,
  tym: <svg className="ico" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 20c0-2.5 1.5-4.5 4-4.5"/></svg>,
};

interface Props { slug: string; cekajici: number; opravneni: string[]; isOwner: boolean }

export function Navigace({ slug, cekajici, opravneni, isOwner }: Props) {
  const pathname = usePathname();
  const ma = (p: string) => isOwner || opravneni.includes(p);
  const on = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const hlavni = [
    { href: `/${slug}/prehled`, label: "Přehled", ico: I.prehled },
    { href: `/${slug}/tvorba`, label: "Vytvořit obsah", ico: I.tvorba, show: ma("content.create") },
    { href: `/${slug}/media`, label: "Mediální knihovna", ico: I.media, show: ma("media.read") },
    { href: `/${slug}/menu`, label: "Menu", ico: I.menu, show: ma("menu.read") },
    { href: `/${slug}/sablony`, label: "Šablony", ico: I.sablony },
    { href: `/${slug}/kalendar`, label: "Kalendář", ico: I.kalendar },
    { href: `/${slug}/schvalovani`, label: "Ke schválení", ico: I.schvaleni, cislo: cekajici },
    { href: `/${slug}/kampane`, label: "Kampaně a automatizace", ico: I.kampane },
    { href: `/${slug}/publikace`, label: "Publikované", ico: I.publikace },
    { href: `/${slug}/analytika`, label: "Analytika", ico: I.analytika, show: ma("analytics.read") },
  ].filter((x) => x.show !== false);

  const nastaveni = [
    { href: `/${slug}/brand`, label: "Brand kit provozovny", ico: I.brand },
    { href: `/nastaveni/integrace`, label: "Integrace a nástroje", ico: I.integrace, show: ma("integrations.use") || ma("integrations.manage") },
    { href: `/nastaveni/tym`, label: "Tým, role a audit", ico: I.tym },
  ].filter((x) => x.show !== false);

  // Spodní lišta na mobilu: pět zkratek v tomhle pořadí. Na co uživatel
  // nemá právo, v `hlavni` není — takové místo se doplní další položkou
  // v pořadí, ale nikdy tou, která už v liště je. Dřív se tu při chybějícím
  // právu „Vytvořit obsah“ objevila Mediální knihovna dvakrát a React
  // hlásil dva stejné klíče.
  const zkratky = ["Přehled", "Vytvořit obsah", "Kalendář", "Ke schválení", "Mediální knihovna"];
  const spodni = [...zkratky.map((l) => hlavni.find((x) => x.label === l)), ...hlavni]
    .filter((x) => x !== undefined)
    .filter((x, i, a) => a.findIndex((y) => y.href === x.href) === i)
    .slice(0, 5);

  return (
    <>
      <nav className="sloupec" aria-label="Hlavní navigace">
        <div className="skupina">Provozovna</div>
        {hlavni.map((x) => (
          <a key={x.href} href={x.href} className={`nav-a${on(x.href) ? " on" : ""}`}>
            {x.ico}<span>{x.label}</span>{x.cislo ? <span className="cislo">{x.cislo}</span> : null}
          </a>
        ))}
        <div className="skupina">Nastavení</div>
        {nastaveni.map((x) => (
          <a key={x.href} href={x.href} className={`nav-a${on(x.href) ? " on" : ""}`}>{x.ico}<span>{x.label}</span></a>
        ))}
      </nav>
      <nav className="spodni" aria-label="Rychlá navigace">
        {spodni.map((x) => (
          <a key={x.href} href={x.href} className={on(x.href) ? "on" : ""}>{x.ico}<span>{x.label.split(" ")[0]}</span></a>
        ))}
      </nav>
    </>
  );
}
