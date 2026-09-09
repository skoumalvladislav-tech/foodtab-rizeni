"use client";

import { usePathname, useRouter } from "next/navigation";

interface V { slug: string; name: string; color: string }

/** Přepínač provozovny — zachová stejnou obrazovku v jiné provozovně. */
export function PrepinacProvozovny({ venues, current }: { venues: V[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="venue-switch">
      <span className="venue-dot" aria-hidden />
      <span className="sr-only">Provozovna</span>
      <select
        value={current}
        onChange={(e) => {
          const parts = pathname.split("/");
          parts[1] = e.target.value;
          router.push(parts.join("/") || `/${e.target.value}/prehled`);
        }}
      >
        {venues.map((v) => (
          <option key={v.slug} value={v.slug}>{v.name}</option>
        ))}
      </select>
    </label>
  );
}
