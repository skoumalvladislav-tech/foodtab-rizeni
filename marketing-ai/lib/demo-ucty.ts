/**
 * Demo účty — pevná ID, aby se na ně daly odkazovat testy a seed.
 *
 * Existují jen v demo režimu (APP_MODE=demo). V produkci přihlášení
 * demo účtem neexistuje a seed se nespouští.
 *
 * Adresy jsou na doméně example.com — nikdy nepatří skutečnému člověku.
 */
export const DEMO_ORG = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "foodtab-demo",
  name: "FoodTab (demo organizace)",
} as const;

export const DEMO_ORG_2 = {
  id: "10000000-0000-4000-8000-000000000002",
  slug: "demo-bistro",
  name: "Demo Bistro (druhá organizace)",
} as const;

export const DEMO_VENUES = {
  cernaPerla: { id: "20000000-0000-4000-8000-000000000001", slug: "cerna-perla", name: "Černá Perla", color: "plum" },
  bernardBar: { id: "20000000-0000-4000-8000-000000000002", slug: "bernard-bar-tabor", name: "Bernard Bar Tábor", color: "copper" },
  bistro: { id: "20000000-0000-4000-8000-000000000003", slug: "bistro-centrum", name: "Bistro Centrum", color: "teal" },
} as const;

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  /** Klíč role v organizaci */
  role: "owner" | "admin" | "marketing_manager" | "editor" | "approver" | "viewer";
  organizationId: string;
  /** 'organization' = všechny provozovny; jinak seznam ID provozoven */
  scope: "organization" | string[];
  description: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "vlastnik@example.com",
    name: "Vlasta Vlastníková",
    role: "owner",
    organizationId: DEMO_ORG.id,
    scope: "organization",
    description: "Vlastník organizace — vidí obě provozovny, spravuje integrace a tým.",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "manazer@example.com",
    name: "Marek Manažer",
    role: "marketing_manager",
    organizationId: DEMO_ORG.id,
    scope: "organization",
    description: "Marketingový manažer — tvoří, schvaluje, plánuje a publikuje na obou provozovnách.",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    email: "schvalovatel@example.com",
    name: "Simona Schvalovatelka",
    role: "approver",
    organizationId: DEMO_ORG.id,
    scope: "organization",
    description: "Schvalovatel — schvaluje nebo vrací, sám netvoří.",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    email: "editor-perla@example.com",
    name: "Eda Editor",
    role: "editor",
    organizationId: DEMO_ORG.id,
    scope: [DEMO_VENUES.cernaPerla.id],
    description: "Editor jen pro Černou Perlu — Bernard Bar nevidí.",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    email: "editor-bernard@example.com",
    name: "Bára Bernardová",
    role: "editor",
    organizationId: DEMO_ORG.id,
    scope: [DEMO_VENUES.bernardBar.id],
    description: "Editor jen pro Bernard Bar Tábor — Černou Perlu nevidí.",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    email: "pozorovatel@example.com",
    name: "Petr Pozorovatel",
    role: "viewer",
    organizationId: DEMO_ORG.id,
    scope: "organization",
    description: "Pozorovatel — jen náhled a analytika.",
  },
  {
    id: "00000000-0000-4000-8000-000000000011",
    email: "bistro@example.com",
    name: "Bohdana Bistrová",
    role: "owner",
    organizationId: DEMO_ORG_2.id,
    scope: "organization",
    description: "Vlastník DRUHÉ organizace — nesmí vidět nic z FoodTab demo organizace.",
  },
];

export function findDemoUser(idOrEmail: string): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.id === idOrEmail || u.email === idOrEmail.toLowerCase());
}
