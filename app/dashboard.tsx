"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  formatMonthLabel,
  getMonthGrid,
  groupByDate,
  nextMonth,
  prevMonth,
  type RosterMember,
  type ShiftRow,
} from "../lib/shift-calendar";

type NavId =
  | "overview"
  | "finance"
  | "apps"
  | "access"
  | "attendance"
  | "tasks"
  | "communication"
  | "recipes"
  | "menus"
  | "ai"
  | "motivation"
  | "install"
  | "settings";
type Task = {
  id: number;
  title: string;
  meta: string;
  time: string;
  priority: boolean;
  completed: boolean;
};
type AudienceType = "company" | "branch" | "person";
type Post = {
  id: number;
  author: string;
  role: string;
  text: string;
  time: string;
  originLocation: string;
  audienceType: AudienceType;
  targetBranchId?: string | null;
  targetPersonName?: string | null;
};
type AssignedTask = {
  id: number;
  title: string;
  note: string;
  createdByName: string;
  originLocation: string;
  audienceType: AudienceType;
  targetBranchId?: string | null;
  targetPersonName?: string | null;
  targetPersonEmail?: string | null;
  dueAt: string;
  priority: "normal" | "high";
  completed: boolean;
};
type AssignedTaskDraft = {
  title: string;
  note: string;
  audienceType: AudienceType;
  recipient: string;
  dueAt: string;
  priority: "normal" | "high";
};
type Recipe = {
  id: number;
  branchId: string;
  name: string;
  category: string;
  portions: number;
  allergens: string;
  ingredients: string;
  instructions: string;
  updatedAt?: string;
};
type RecipeDraft = Omit<Recipe, "id" | "updatedAt">;
type MenuType = "permanent" | "weekly";
type MenuItem = {
  id: number;
  branchId: string;
  menuType: MenuType;
  name: string;
  description: string;
  category: string;
  price: number;
  allergens: string;
  dayLabel: string;
  active: boolean;
};
type MenuItemDraft = Omit<MenuItem, "id" | "active">;
type WeeklyMenuDocument = {
  id: number;
  branchId: string;
  weekLabel: string;
  fileName: string;
  fileSize: number;
  source: "dashboard" | "ai_agent";
  status: "ready" | "processing" | "failed";
  active: boolean;
  uploadedBy: string;
  uploadedAt: string;
};
type AiMessage = {
  id: number;
  from: "assistant" | "user";
  text: string;
  source?: string;
};
type Branch = { id: string; name: string; active: boolean };
type AccessStatus = "pending" | "approved" | "rejected" | "suspended";
type AccessUser = {
  id: string;
  email: string;
  fullName: string;
  authProvider: "email" | "google" | "apple";
  status: AccessStatus;
  branchId: string | null;
  role: string | null;
  permissions: string[];
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};
type AuthorizedFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const accessRoles = [
  ["branch_manager", "Vedoucí pobočky"],
  ["kitchen", "Kuchyně"],
  ["service", "Servis"],
  ["bar", "Bar"],
  ["administrator", "Administrátor"],
] as const;

const accessModules = [
  ["attendance", "Docházka"],
  ["shifts", "Směny"],
  ["tasks", "Úkoly"],
  ["communication", "Komunikace"],
  ["recipes", "Recepty"],
  ["menus", "Jídelní lístky"],
  ["ai", "Gastro AI"],
  ["motivation", "Motivace"],
  ["finance", "Finance"],
] as const;

const companyNav: Array<{ id: NavId; label: string; mark: string }> = [
  { id: "overview", label: "Dashboard firmy", mark: "DF" },
  { id: "finance", label: "Finance a výsledky", mark: "FI" },
  { id: "apps", label: "Aplikace a moduly", mark: "AP" },
  { id: "access", label: "Uživatelé a přístupy", mark: "UP" },
];

const operationNav: Array<{ id: NavId; label: string; mark: string }> = [
  { id: "attendance", label: "Směny a docházka", mark: "S" },
  { id: "tasks", label: "Úkoly a checklisty", mark: "Ú" },
  { id: "communication", label: "Komunikace", mark: "K" },
  { id: "recipes", label: "Recepty", mark: "R" },
  { id: "menus", label: "Jídelní lístky", mark: "JL" },
  { id: "ai", label: "Gastro AI", mark: "AI" },
  { id: "motivation", label: "Tým a motivace", mark: "T" },
];

const adminNav: Array<{ id: NavId; label: string; mark: string }> = [
  { id: "install", label: "Mobilní aplikace", mark: "MB" },
  { id: "settings", label: "Nastavení", mark: "N" },
];

const navIds = new Set<NavId>([
  "overview",
  "finance",
  "apps",
  "access",
  "attendance",
  "tasks",
  "communication",
  "recipes",
  "menus",
  "ai",
  "motivation",
  "install",
  "settings",
]);

const initialTasks: Task[] = [
  {
    id: 1,
    title: "Kontrola teplot lednic",
    meta: "HACCP · Kuchyně",
    time: "do 10:00",
    priority: true,
    completed: false,
  },
  {
    id: 2,
    title: "Převzít dodávku Bernard",
    meta: "Sklad · Bar",
    time: "11:30",
    priority: false,
    completed: true,
  },
  {
    id: 3,
    title: "Doplnit vinný lístek",
    meta: "Provoz · Bar",
    time: "do 16:00",
    priority: false,
    completed: false,
  },
  {
    id: 4,
    title: "Briefing před večerní směnou",
    meta: "Tým · Všichni",
    time: "16:15",
    priority: true,
    completed: false,
  },
];

const people = [
  ["Anna Nováková", "Servis", "1 280", "+85", "AN"],
  ["Tomáš Král", "Kuchyně", "1 195", "+60", "TK"],
  ["Eliška Marková", "Bar", "1 140", "+95", "EM"],
  ["Petr Dvořák", "Servis", "1 085", "+40", "PD"],
];

const defaultBranches: Branch[] = [
  {
    id: "restaurace-cerna-perla",
    name: "Restaurace Černá Perla",
    active: true,
  },
  { id: "bernard-bar-tabor", name: "Bernard Bar Tábor", active: true },
];

const employees = [
  {
    name: "Klára Veselá",
    email: "klara@foodtab.cz",
    branchId: "restaurace-cerna-perla",
    role: "Provozní",
  },
  {
    name: "Martin Šíma",
    email: "martin@foodtab.cz",
    branchId: "restaurace-cerna-perla",
    role: "Šéfkuchař",
  },
  {
    name: "Eliška Marková",
    email: "eliska@foodtab.cz",
    branchId: "bernard-bar-tabor",
    role: "Vedoucí baru",
  },
  {
    name: "Anna Nováková",
    email: "anna@foodtab.cz",
    branchId: "bernard-bar-tabor",
    role: "Servis",
  },
];

const initialAssignedTasks: AssignedTask[] = [
  {
    id: -1,
    title: "Předat víkendové objednávky",
    note: "Potvrdit množství sudů a nealko sortimentu.",
    createdByName: "Lucka",
    originLocation: "Foodtab s.r.o. · Celá firma",
    audienceType: "branch",
    targetBranchId: "bernard-bar-tabor",
    dueAt: "2026-08-18T12:00",
    priority: "high",
    completed: false,
  },
  {
    id: -2,
    title: "Aktualizovat polední nabídku",
    note: "Doplnit alergeny a gramáže.",
    createdByName: "Lucka",
    originLocation: "Foodtab s.r.o. · Celá firma",
    audienceType: "branch",
    targetBranchId: "restaurace-cerna-perla",
    dueAt: "2026-08-18T09:00",
    priority: "normal",
    completed: false,
  },
];

const initialRecipes: Recipe[] = [
  {
    id: -1,
    branchId: "restaurace-cerna-perla",
    name: "Telecí líčka na víně",
    category: "Hlavní jídlo",
    portions: 10,
    allergens: "1, 7, 9",
    ingredients:
      "2,5 kg telecích líček\nkořenová zelenina\nčervené víno\ntelecí fond",
    instructions:
      "Maso zatáhnout, přidat zeleninu a víno. Pomalu dusit doměkka, omáčku přecedit a zredukovat.",
  },
  {
    id: -2,
    branchId: "restaurace-cerna-perla",
    name: "Crème brûlée",
    category: "Dezert",
    portions: 12,
    allergens: "3, 7",
    ingredients: "smetana\nžloutky\nvanilka\ncukr",
    instructions:
      "Směs nalít do misek, péct ve vodní lázni a před servisem zkaramelizovat cukr.",
  },
  {
    id: -3,
    branchId: "bernard-bar-tabor",
    name: "Bernardský hovězí guláš",
    category: "Hlavní jídlo",
    portions: 10,
    allergens: "1",
    ingredients: "hovězí kližka\ncibule\ntmavé pivo Bernard\nkoření",
    instructions:
      "Cibuli opéct do tmava, přidat maso a koření. Podlít pivem a dusit doměkka.",
  },
  {
    id: -4,
    branchId: "bernard-bar-tabor",
    name: "Nakládaný hermelín",
    category: "K pivu",
    portions: 8,
    allergens: "7",
    ingredients: "hermelín\ncibule\nčesnek\nchilli\nolej",
    instructions:
      "Sýr proložit kořením, zalít olejem a nechat alespoň tři dny zrát v chladu.",
  },
];

const initialMenuItems: MenuItem[] = [
  {
    id: -1,
    branchId: "restaurace-cerna-perla",
    menuType: "permanent",
    name: "Telecí líčka na červeném víně",
    description: "Bramborové pyré, kořenová zelenina",
    category: "Hlavní jídlo",
    price: 295,
    allergens: "1, 7, 9",
    dayLabel: "",
    active: true,
  },
  {
    id: -2,
    branchId: "restaurace-cerna-perla",
    menuType: "permanent",
    name: "Candát na másle",
    description: "Bylinkové brambory, grilovaná zelenina",
    category: "Hlavní jídlo",
    price: 319,
    allergens: "4, 7",
    dayLabel: "",
    active: true,
  },
  {
    id: -3,
    branchId: "restaurace-cerna-perla",
    menuType: "weekly",
    name: "Kuřecí supreme",
    description: "Hráškové risotto a parmazán",
    category: "Polední nabídka",
    price: 189,
    allergens: "7, 9",
    dayLabel: "Pondělí",
    active: true,
  },
  {
    id: -4,
    branchId: "bernard-bar-tabor",
    menuType: "permanent",
    name: "Bernardský hovězí guláš",
    description: "Kynutý knedlík a cibule",
    category: "Klasika k pivu",
    price: 199,
    allergens: "1, 3, 7",
    dayLabel: "",
    active: true,
  },
  {
    id: -5,
    branchId: "bernard-bar-tabor",
    menuType: "permanent",
    name: "Nakládaný hermelín",
    description: "Cibule, chilli a chléb",
    category: "K pivu",
    price: 139,
    allergens: "1, 7",
    dayLabel: "",
    active: true,
  },
  {
    id: -6,
    branchId: "bernard-bar-tabor",
    menuType: "weekly",
    name: "Vepřový řízek",
    description: "Lehký bramborový salát",
    category: "Polední nabídka",
    price: 179,
    allergens: "1, 3, 7",
    dayLabel: "Pondělí",
    active: true,
  },
];

function clock(date: Date) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function aiAnswer(question: string) {
  const q = question.toLowerCase();
  if (q.includes("alergen") || q.includes("lepek"))
    return {
      text: "Vždy otevři aktuální recepturu jídla a ověř alergeny i možné křížové znečištění s kuchyní. Hostovi neslibuj nepřítomnost stopového množství bez potvrzení vedoucího kuchyně.",
      source: "Standard obsluhy · Alergeny, verze 3.2",
    };
  if (q.includes("pivo") || q.includes("bernard"))
    return {
      text: "Sklenici opláchni studenou vodou, drž ji za spodní třetinu a čepuj pod úhlem. Hladinku dokonči jedním tahem tak, aby vznikla kompaktní mokrá pěna.",
      source: "Manuál Bernard · Kultura čepování 2026",
    };
  if (q.includes("reklamac") || q.includes("stížnost"))
    return {
      text: "Nech hosta domluvit, poděkuj za upozornění a omluv se za zkušenost. Nabídni okamžité řešení a zapiš situaci do provozního deníku. Kompenzaci nad 500 Kč schvaluje vedoucí směny.",
      source: "Standard péče o hosta · Reklamace",
    };
  return {
    text: "Nejdřív ověř situaci v příslušném checklistu. Pokud se týká bezpečnosti hosta, hygieny nebo finanční kompenzace, informuj vedoucího směny. Zkus prosím doplnit konkrétní jídlo nebo situaci.",
    source: "Provozní příručka Foodtab · Obecný postup",
  };
}

export default function Dashboard({
  userName,
  userEmail,
  accessToken,
  userRole,
  branchId,
  permissions,
  onSignOut,
}: {
  userName: string;
  userEmail: string;
  accessToken: string;
  userRole: string;
  branchId: string | null;
  permissions: string[];
  onSignOut: () => void | Promise<void>;
}) {
  const isAdministrator = userRole === "administrator";
  const canUse = useCallback(
    (permission: string) => isAdministrator || permissions.includes(permission),
    [isAdministrator, permissions],
  );
  const apiFetch = useCallback<AuthorizedFetch>(
    (input, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${accessToken}`);
      return fetch(input, { ...init, headers });
    },
    [accessToken],
  );
  const initialBranches =
    isAdministrator || branchId === "company"
      ? defaultBranches
      : defaultBranches.filter((branch) => branch.id === branchId);
  const initialLocation =
    branchId === "bernard-bar-tabor"
      ? "Bernard Bar Tábor"
      : branchId === "restaurace-cerna-perla"
        ? "Restaurace Černá Perla"
        : "Foodtab s.r.o. · Celá firma";
  const [active, setActive] = useState<NavId>("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [location, setLocation] = useState(initialLocation);
  const [branches, setBranches] = useState<Branch[]>(initialBranches);
  const [now, setNow] = useState(new Date());
  const [clockedIn, setClockedIn] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const [post, setPost] = useState("");
  const [posts, setPosts] = useState<Post[]>([
    {
      id: 1,
      author: "Martin Šíma",
      role: "Šéfkuchař",
      text: "Dnešní specialita je telecí líčko. Prosím připomenout alergeny 1, 7 a 9 na briefingu.",
      time: "8:42",
      originLocation: "Restaurace Černá Perla",
      audienceType: "branch",
      targetBranchId: "bernard-bar-tabor",
    },
    {
      id: 2,
      author: "Klára Veselá",
      role: "Provozní",
      text: "Ve 14:30 přijde technik na chlazení. Přístup přes zadní vchod.",
      time: "9:18",
      originLocation: "Foodtab s.r.o. · Celá firma",
      audienceType: "branch",
      targetBranchId: "restaurace-cerna-perla",
    },
  ]);
  const [assignedTasks, setAssignedTasks] =
    useState<AssignedTask[]>(initialAssignedTasks);
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);
  const [weeklyMenus, setWeeklyMenus] = useState<WeeklyMenuDocument[]>([]);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([
    {
      id: 1,
      from: "assistant",
      text: "Ahoj, jsem Foodtab Gastro AI. Poradím s provozem, recepturami, alergeny, obsluhou i standardy Černé Perly. Z čeho dnes potřebuješ poradit?",
    },
  ]);
  const visibleCompanyNav = useMemo(
    () =>
      companyNav.filter(
        (item) =>
          item.id === "overview" ||
          (item.id === "finance" ? canUse("finance") : isAdministrator),
      ),
    [canUse, isAdministrator],
  );
  const visibleOperationNav = useMemo(
    () => operationNav.filter((item) => canUse(item.id)),
    [canUse],
  );
  const visibleAdminNav = useMemo(
    () => adminNav.filter((item) => item.id === "install" || isAdministrator),
    [isAdministrator],
  );
  const visibleNavIds = useMemo(
    () =>
      new Set<NavId>(
        [...visibleCompanyNav, ...visibleOperationNav, ...visibleAdminNav].map(
          (item) => item.id,
        ),
      ),
    [visibleAdminNav, visibleCompanyNav, visibleOperationNav],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const requestedModule = new URLSearchParams(window.location.search).get(
      "modul",
    ) as NavId | null;
    if (
      !requestedModule ||
      !navIds.has(requestedModule) ||
      !visibleNavIds.has(requestedModule)
    )
      return;
    const frame = window.requestAnimationFrame(() =>
      setActive(requestedModule),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [visibleNavIds]);
  useEffect(() => {
    let cancelled = false;
    async function loadSavedState() {
      try {
        const response = await apiFetch("/api/operations", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          tasks?: Array<{ id: number; completed: boolean }>;
          lastAttendance?: { action: "in" | "out" } | null;
          posts?: Array<{
            id: number;
            authorName: string;
            role: string;
            text: string;
            location: string;
            audienceType: AudienceType;
            targetBranchId?: string | null;
            targetPersonName?: string | null;
            createdAt: string;
          }>;
          branches?: Branch[];
          assignedTasks?: AssignedTask[];
          recipes?: Recipe[];
          menuItems?: MenuItem[];
          weeklyMenus?: WeeklyMenuDocument[];
        };
        if (cancelled) return;
        if (data.tasks?.length) {
          setTasks((current) =>
            current.map((task) => {
              const saved = data.tasks?.find((item) => item.id === task.id);
              return saved ? { ...task, completed: saved.completed } : task;
            }),
          );
        }
        setClockedIn(data.lastAttendance?.action === "in");
        if (data.branches?.length) setBranches(data.branches);
        if (data.assignedTasks) setAssignedTasks(data.assignedTasks);
        if (data.recipes) setRecipes(data.recipes);
        if (data.menuItems) setMenuItems(data.menuItems);
        if (data.weeklyMenus) setWeeklyMenus(data.weeklyMenus);
        if (data.posts?.length) {
          setPosts(
            data.posts.map((item) => ({
              id: item.id,
              author: item.authorName,
              role: item.role,
              text: item.text,
              time: new Intl.DateTimeFormat("cs-CZ", {
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(`${item.createdAt}Z`)),
              originLocation: item.location,
              audienceType: item.audienceType,
              targetBranchId: item.targetBranchId,
              targetPersonName: item.targetPersonName,
            })),
          );
        }
      } catch {
        // The interface remains usable in demo mode when the database is offline.
      }
    }
    void loadSavedState();
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2700);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const completion = useMemo(
    () =>
      Math.round(
        (tasks.filter((task) => task.completed).length / tasks.length) * 100,
      ),
    [tasks],
  );

  function go(id: NavId) {
    setActive(id);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function toggleTask(id: number) {
    const nextCompleted = !tasks.find((task) => task.id === id)?.completed;
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    );
    setToast("Checklist byl aktualizován");
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "task",
        taskId: id,
        completed: nextCompleted,
        location,
      }),
    }).catch(() => undefined);
  }
  function attendance() {
    const attendanceAction = clockedIn ? "out" : "in";
    setClockedIn((value) => !value);
    setToast(
      clockedIn ? "Odchod zaznamenán" : `Příchod zaznamenán v ${clock(now)}`,
    );
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "attendance",
        attendanceAction,
        location,
      }),
    }).catch(() => undefined);
  }
  function publish(
    event: FormEvent,
    audienceType: AudienceType,
    recipient: string,
  ) {
    event.preventDefault();
    if (!post.trim()) return;
    const person = employees.find((item) => item.email === recipient);
    const targetBranchId = audienceType === "branch" ? recipient : null;
    const targetPersonEmail =
      audienceType === "person" ? (person?.email ?? null) : null;
    const targetPersonName =
      audienceType === "person" ? (person?.name ?? null) : null;
    setPosts((current) => [
      {
        id: Date.now(),
        author: userName,
        role: "Vedení",
        text: post.trim(),
        time: clock(now),
        originLocation: location,
        audienceType,
        targetBranchId,
        targetPersonName,
      },
      ...current,
    ]);
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "post",
        text: post.trim(),
        authorName: userName,
        location,
        audienceType,
        targetBranchId,
        targetPersonEmail,
        targetPersonName,
      }),
    }).catch(() => undefined);
    setPost("");
    setToast(
      audienceType === "person"
        ? "Osobní zpráva byla odeslána"
        : "Zpráva byla zveřejněna",
    );
  }
  function createAssignedTask(draft: AssignedTaskDraft) {
    const person = employees.find((item) => item.email === draft.recipient);
    const tempId = Date.now();
    const created: AssignedTask = {
      id: tempId,
      title: draft.title,
      note: draft.note,
      createdByName: userName,
      originLocation: location,
      audienceType: draft.audienceType,
      targetBranchId: draft.audienceType === "branch" ? draft.recipient : null,
      targetPersonEmail:
        draft.audienceType === "person" ? (person?.email ?? null) : null,
      targetPersonName:
        draft.audienceType === "person" ? (person?.name ?? null) : null,
      dueAt: draft.dueAt,
      priority: draft.priority,
      completed: false,
    };
    setAssignedTasks((current) => [created, ...current]);
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "assignedTask",
        ...created,
        authorName: userName,
        location,
      }),
    })
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{ assignedTask: AssignedTask }>)
          : null,
      )
      .then(
        (data) =>
          data &&
          setAssignedTasks((current) =>
            current.map((item) =>
              item.id === tempId ? data.assignedTask : item,
            ),
          ),
      )
      .catch(() => undefined);
    setToast("Úkol byl zadán");
  }
  function completeAssignedTask(id: number) {
    const nextCompleted = !assignedTasks.find((task) => task.id === id)
      ?.completed;
    setAssignedTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task,
      ),
    );
    if (id > 0)
      void apiFetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "assignedTaskCompletion",
          taskId: id,
          completed: nextCompleted,
        }),
      }).catch(() => undefined);
    setToast("Stav úkolu byl aktualizován");
  }
  function createRecipe(draft: RecipeDraft) {
    const tempId = Date.now();
    const created: Recipe = { id: tempId, ...draft };
    setRecipes((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name, "cs")),
    );
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "recipe", ...draft }),
    })
      .then(async (response) =>
        response.ok ? (response.json() as Promise<{ recipe: Recipe }>) : null,
      )
      .then(
        (data) =>
          data &&
          setRecipes((current) =>
            current.map((item) => (item.id === tempId ? data.recipe : item)),
          ),
      )
      .catch(() => undefined);
    setToast("Recept byl uložen k pobočce");
  }
  function createMenuItem(draft: MenuItemDraft) {
    const tempId = Date.now();
    const created: MenuItem = { id: tempId, active: true, ...draft };
    setMenuItems((current) => [...current, created]);
    void apiFetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "menuItem", ...draft }),
    })
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{ menuItem: MenuItem }>)
          : null,
      )
      .then(
        (data) =>
          data &&
          setMenuItems((current) =>
            current.map((item) => (item.id === tempId ? data.menuItem : item)),
          ),
      )
      .catch(() => undefined);
    setToast("Položka byla přidána do stálého jídelního lístku");
  }
  function registerWeeklyMenu(document: WeeklyMenuDocument) {
    setWeeklyMenus((current) => [
      document,
      ...current.map((item) =>
        item.branchId === document.branchId ? { ...item, active: false } : item,
      ),
    ]);
    setToast(
      document.source === "ai_agent"
        ? "PDF od AI agenta bylo zveřejněno"
        : "Týdenní menu v PDF bylo zveřejněno",
    );
  }
  function ask(event: FormEvent) {
    event.preventDefault();
    const clean = question.trim();
    if (!clean) return;
    const reply = aiAnswer(clean);
    setMessages((current) => [
      ...current,
      { id: Date.now(), from: "user", text: clean },
      {
        id: Date.now() + 1,
        from: "assistant",
        text: reply.text,
        source: reply.source,
      },
    ]);
    setQuestion("");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-seal">F</span>
          <span>
            <strong>foodtab</strong>
            <small>restaurant operations</small>
          </span>
        </div>
        <nav className="main-nav" aria-label="Hlavní navigace">
          <p>FOODTAB S.R.O.</p>
          {visibleCompanyNav.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <span>{item.mark}</span>
              {item.label}
            </button>
          ))}
          <p className="spaced">PROVOZ RESTAURACÍ</p>
          {visibleOperationNav.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <span>{item.mark}</span>
              {item.label}
              {item.id === "communication" && <b>3</b>}
            </button>
          ))}
          <p className="spaced">SPRÁVA</p>
          {visibleAdminNav.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <span>{item.mark}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="user-row">
          <i>{initials(userName)}</i>
          <div>
            <strong>{userName}</strong>
            <small>
              {roleName(userRole)} · {userEmail}
            </small>
          </div>
          <button
            className="sign-out-button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await onSignOut();
              } finally {
                setSigningOut(false);
              }
            }}
            aria-label="Odhlásit se"
            title="Odhlásit se"
          >
            <span aria-hidden="true">↪</span>
            {signingOut ? "Odhlašuji…" : "Odhlásit se"}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="Otevřít menu"
          >
            ☰
          </button>
          <div className="location">
            <i />
            <select
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            >
              {(isAdministrator || branchId === "company") && (
                <option>Foodtab s.r.o. · Celá firma</option>
              )}
              {branches.map((branch) => (
                <option key={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>
          <div className="top-actions">
            <button className="search" onClick={() => go("ai")}>
              ⌕ <span>Hledat nebo se zeptat AI</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className="bell">
              ◇<i />
            </button>
            <div className="date">
              <strong suppressHydrationWarning>{clock(now)}</strong>
              <span>pondělí 17. srpna</span>
            </div>
          </div>
        </header>
        <main className="content">
          {active === "overview" && (
            <Overview
              userName={userName}
              branches={branches}
              go={go}
              setLocation={setLocation}
            />
          )}
          {active === "finance" && <CompanyFinance />}
          {active === "apps" && <AppManagement branchCount={branches.length} />}
          {active === "access" && (
            <AccessManagement branches={branches} apiFetch={apiFetch} />
          )}
          {active === "attendance" && (
            <Attendance
              clockedIn={clockedIn}
              now={now}
              attendance={attendance}
              branches={branches}
              apiFetch={apiFetch}
              canUse={canUse}
              userEmail={userEmail}
              userBranchId={branchId}
            />
          )}
          {active === "tasks" && (
            <Tasks
              location={location}
              branches={branches}
              tasks={tasks}
              assignedTasks={assignedTasks}
              completion={completion}
              toggleTask={toggleTask}
              createAssignedTask={createAssignedTask}
              completeAssignedTask={completeAssignedTask}
            />
          )}
          {active === "communication" && (
            <Communication
              location={location}
              branches={branches}
              posts={posts}
              post={post}
              setPost={setPost}
              publish={publish}
            />
          )}
          {active === "recipes" && (
            <Recipes
              key={location}
              location={location}
              branches={branches}
              recipes={recipes}
              createRecipe={createRecipe}
            />
          )}
          {active === "menus" && (
            <Menus
              key={location}
              location={location}
              branches={branches}
              menuItems={menuItems}
              weeklyMenus={weeklyMenus}
              createMenuItem={createMenuItem}
              registerWeeklyMenu={registerWeeklyMenu}
              apiFetch={apiFetch}
            />
          )}
          {active === "ai" && (
            <GastroAi
              messages={messages}
              question={question}
              setQuestion={setQuestion}
              ask={ask}
            />
          )}
          {active === "motivation" && <Motivation />}
          {active === "install" && <InstallCenter />}
          {active === "settings" && <Settings />}
        </main>
      </div>

      <nav className="mobile-nav">
        {[...visibleCompanyNav, ...visibleOperationNav, ...visibleAdminNav]
          .slice(0, 5)
          .map((item) => (
            <button
              key={item.id}
              className={active === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <span>{item.mark}</span>
              {item.id === "overview"
                ? "Firma"
                : item.id === "finance"
                  ? "Finance"
                  : item.id === "attendance"
                    ? "Směna"
                    : item.label.replace("Gastro ", "")}
            </button>
          ))}
      </nav>
      {menu && (
        <button
          className="scrim"
          onClick={() => setMenu(false)}
          aria-label="Zavřít menu"
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}

function Intro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="intro">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {action}
    </div>
  );
}

function Overview({
  userName,
  branches,
  go,
  setLocation,
}: {
  userName: string;
  branches: Branch[];
  go: (id: NavId) => void;
  setLocation: (value: string) => void;
}) {
  const branchDetails: Record<
    string,
    {
      initials: string;
      team: string;
      target: string;
      checklist: string;
      tasks: string;
    }
  > = {
    "restaurace-cerna-perla": {
      initials: "ČP",
      team: "7 lidí na směně",
      target: "49 000 Kč",
      checklist: "78 %",
      tasks: "1 čeká",
    },
    "bernard-bar-tabor": {
      initials: "BB",
      team: "5 lidí na směně",
      target: "35 600 Kč",
      checklist: "66 %",
      tasks: "2 čekají",
    },
  };
  return (
    <>
      <Intro
        eyebrow="FOODTAB S.R.O. · CENTRÁLNÍ PŘEHLED"
        title={`Dobré ráno, ${userName}.`}
        description="Finance, provozovny, lidé a firemní aplikace na jednom místě."
        action={
          <button className="primary" onClick={() => go("finance")}>
            <span>FI</span> Otevřít finance
          </button>
        }
      />
      <section className="pulse company-pulse">
        <header>
          <span>
            <i /> FIRMA V PROVOZU
          </span>
          <small>Data za srpen 2026 · aktualizováno dnes</small>
        </header>
        <div>
          <Metric
            label="TRŽBY FIRMY"
            value="1 264 800"
            unit="Kč"
            note="↗ 8,4 % proti červenci"
          />
          <Metric
            label="PROVOZNÍ VÝSLEDEK"
            value="214 600"
            unit="Kč"
            note="Marže 17,0 %"
          />
          <Metric
            label="POBOČKY"
            value={`${branches.length}`}
            unit="aktivní"
            note="Obě pobočky v provozu"
          />
          <Metric
            label="ZAMĚSTNANCI"
            value="18"
            unit="osob"
            note="12 dnes na směně"
          />
        </div>
      </section>
      <div className="company-grid">
        <section className="card finance-snapshot">
          <CardHead
            eyebrow="FINANCE FIRMY"
            title="Výsledek za srpen"
            aside={
              <button className="link" onClick={() => go("finance")}>
                Detail financí →
              </button>
            }
          />
          <div className="finance-waterfall">
            <div>
              <span>Tržby</span>
              <strong>1 264 800 Kč</strong>
              <i style={{ width: "100%" }} />
            </div>
            <div>
              <span>Provozní náklady</span>
              <strong>− 710 200 Kč</strong>
              <i className="cost" style={{ width: "56%" }} />
            </div>
            <div>
              <span>Mzdy a odvody</span>
              <strong>− 340 000 Kč</strong>
              <i className="cost" style={{ width: "27%" }} />
            </div>
            <div className="result">
              <span>Provozní výsledek</span>
              <strong>214 600 Kč</strong>
              <i style={{ width: "17%" }} />
            </div>
          </div>
          <footer>
            <span>
              <i className="positive-dot" /> Cashflow v pořádku
            </span>
            <span>3 závazky čekají na úhradu</span>
          </footer>
        </section>

        <section className="card branch-card">
          <CardHead
            eyebrow="POBOČKY"
            title="Stav provozoven"
            aside={
              <span className="status live">{branches.length} aktivní</span>
            }
          />
          {branches.map((branch) => {
            const detail = branchDetails[branch.id] ?? {
              initials: "PB",
              team: "směna připravena",
              target: "— Kč",
              checklist: "—",
              tasks: "—",
            };
            return (
              <div className="branch-entry" key={branch.id}>
                <button
                  className="branch-row"
                  onClick={() => {
                    setLocation(branch.name);
                    go("attendance");
                  }}
                >
                  <span className="branch-logo">{detail.initials}</span>
                  <div>
                    <strong>{branch.name}</strong>
                    <small>Otevřeno · {detail.team}</small>
                  </div>
                  <div>
                    <strong>{detail.target}</strong>
                    <small>dnešní cíl tržby</small>
                  </div>
                  <b>→</b>
                </button>
                <div className="branch-health">
                  <span>
                    <i className="ok" /> Personál <b>pokrytý</b>
                  </span>
                  <span>
                    <i className="ok" /> Checklist <b>{detail.checklist}</b>
                  </span>
                  <span>
                    <i className="warn" /> Úkoly <b>{detail.tasks}</b>
                  </span>
                </div>
              </div>
            );
          })}
          <button className="add-branch">+ Přidat další pobočku</button>
        </section>

        <section className="card company-apps">
          <CardHead
            eyebrow="FIREMNÍ APLIKACE"
            title="Aktivní moduly"
            aside={
              <button className="link" onClick={() => go("apps")}>
                Upravit aplikace →
              </button>
            }
          />
          <div>
            {[
              ["DO", "Docházka", "18 uživatelů"],
              ["ÚK", "Úkoly", "7 otevřených"],
              ["KO", "Komunikace", "3 nové zprávy"],
              ["AI", "Gastro AI", "42 zdrojů"],
            ].map((app) => (
              <button
                key={app[1]}
                onClick={() =>
                  go(
                    app[0] === "DO"
                      ? "attendance"
                      : app[0] === "ÚK"
                        ? "tasks"
                        : app[0] === "KO"
                          ? "communication"
                          : "ai",
                  )
                }
              >
                <span>{app[0]}</span>
                <strong>
                  {app[1]}
                  <small>{app[2]}</small>
                </strong>
                <i>Aktivní</i>
              </button>
            ))}
          </div>
        </section>

        <section className="card agenda-card">
          <CardHead eyebrow="AGENDA VEDENÍ" title="Co vyžaduje pozornost" />
          <div className="agenda-list">
            <button>
              <span className="urgent-mark">!</span>
              <div>
                <strong>Schválit podklady pro mzdy</strong>
                <small>Termín dnes · 18 zaměstnanců</small>
              </div>
              <b>→</b>
            </button>
            <button>
              <span>FA</span>
              <div>
                <strong>3 přijaté faktury k úhradě</strong>
                <small>Celkem 64 280 Kč · splatnost do 20. 8.</small>
              </div>
              <b>→</b>
            </button>
            <button>
              <span>UP</span>
              <div>
                <strong>Dokončit přístupy vedoucích</strong>
                <small>2 uživatelé bez vícefázového ověření</small>
              </div>
              <b>→</b>
            </button>
          </div>
        </section>

        <section className="card access-snapshot">
          <CardHead
            eyebrow="PŘÍSTUPY"
            title="Uživatelé a zabezpečení"
            aside={
              <button className="link" onClick={() => go("access")}>
                Spravovat →
              </button>
            }
          />
          <div className="access-ring">
            <strong>
              18<small>uživatelů</small>
            </strong>
          </div>
          <div className="access-facts">
            <span>
              <b>5</b> pracovních rolí
            </span>
            <span>
              <b>2</b> administrátoři
            </span>
            <span>
              <b className="safe">16</b> účtů v pořádku
            </span>
            <span>
              <b className="warning">2</b> vyžadují kontrolu
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
  progress,
}: {
  label: string;
  value: string;
  unit: string;
  note?: string;
  progress?: number;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong>
        {value} <em>{unit}</em>
      </strong>
      {note && <span>{note}</span>}
      {progress !== undefined && (
        <div className="progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
function CardHead({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <header className="card-head">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {aside}
    </header>
  );
}
function TaskRow({
  task,
  toggle,
}: {
  task: Task;
  toggle: (id: number) => void;
}) {
  return (
    <label className={`task-row ${task.completed ? "done" : ""}`}>
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => toggle(task.id)}
      />
      <i>✓</i>
      <span>
        <strong>{task.title}</strong>
        <small>{task.meta}</small>
      </span>
      <time className={task.priority && !task.completed ? "urgent" : ""}>
        {task.time}
      </time>
    </label>
  );
}

type ShiftDraft = {
  department: "bar" | "kuchyne";
  startTime: string;
  endTime: string;
  note: string;
  employeeSource: "registered" | "new";
  employeeUserId?: string;
  employeeName?: string;
  employeeEmail?: string;
};

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatDayLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(year, month - 1, day));
}

function Attendance({
  clockedIn,
  now,
  attendance,
  branches,
  apiFetch,
  canUse,
  userEmail,
  userBranchId,
}: {
  clockedIn: boolean;
  now: Date;
  attendance: () => void;
  branches: Branch[];
  apiFetch: AuthorizedFetch;
  canUse: (permission: string) => boolean;
  userEmail: string;
  userBranchId: string | null;
}) {
  const canManageShifts = canUse("shifts");
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [selectedBranchId, setSelectedBranchId] = useState(
    (userBranchId && userBranchId !== "company"
      ? userBranchId
      : branches[0]?.id) || "",
  );
  const [departmentFilter, setDepartmentFilter] = useState<
    "all" | "bar" | "kuchyne"
  >("all");
  const [shiftRows, setShiftRows] = useState<ShiftRow[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const requestKey = `${selectedBranchId}|${monthKey(cursor.year, cursor.month)}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    if (!selectedBranchId) return;
    let cancelled = false;
    apiFetch(
      `/api/shifts?branchId=${encodeURIComponent(selectedBranchId)}&month=${monthKey(cursor.year, cursor.month)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = (await response.json()) as {
          shifts?: ShiftRow[];
          roster?: RosterMember[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "Směny se nepodařilo načíst.");
        if (!cancelled) {
          setShiftRows(data.shifts ?? []);
          setRoster(data.roster ?? []);
          setError("");
        }
      })
      .catch(
        (reason: unknown) =>
          !cancelled &&
          setError(
            reason instanceof Error
              ? reason.message
              : "Směny se nepodařilo načíst.",
          ),
      )
      .finally(() => !cancelled && setLoadedKey(requestKey));
    return () => {
      cancelled = true;
    };
  }, [apiFetch, selectedBranchId, cursor.year, cursor.month, requestKey]);

  const visibleRows = useMemo(
    () =>
      departmentFilter === "all"
        ? shiftRows
        : shiftRows.filter((row) => row.department === departmentFilter),
    [shiftRows, departmentFilter],
  );
  const shiftsByDate = useMemo(() => groupByDate(visibleRows), [visibleRows]);
  const dayShifts = selectedDate ? (shiftsByDate[selectedDate] ?? []) : [];

  async function createShift(draft: ShiftDraft) {
    if (!selectedDate || !selectedBranchId) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          branchId: selectedBranchId,
          shiftDate: selectedDate,
          ...draft,
        }),
      });
      const data = (await response.json()) as {
        shift?: ShiftRow;
        error?: string;
      };
      if (!response.ok || !data.shift)
        throw new Error(data.error || "Směnu se nepodařilo uložit.");
      setShiftRows((current) => [...current, data.shift as ShiftRow]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Směnu se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteShift(id: number) {
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Směnu se nepodařilo smazat.");
      setShiftRows((current) => current.filter((row) => row.id !== id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Směnu se nepodařilo smazat.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Intro
        eyebrow="PERSONÁL"
        title="Směny a docházka"
        description={
          canManageShifts
            ? "Plánujte směny podle pobočky a střediska (bar, kuchyně)."
            : "Přehled vlastních a kolegových směn v aktuálním měsíci."
        }
        action={
          <button
            className={clockedIn ? "secondary" : "primary"}
            onClick={attendance}
          >
            {clockedIn ? "Ukončit směnu" : "Zaznamenat příchod"}
          </button>
        }
      />
      <Summary
        items={[
          [
            "DNEŠNÍ PŘÍCHOD",
            clockedIn ? clock(now) : "—",
            clockedIn ? "včas" : "nezaznamenáno",
          ],
          ["SMĚNY V MĚSÍCI", String(shiftRows.length), "napříč středisky"],
          [
            "MOJE SMĚNY",
            String(
              shiftRows.filter(
                (row) => row.employeeEmail === userEmail.toLowerCase(),
              ).length,
            ),
            "tento měsíc",
          ],
        ]}
      />
      <section className="card wide">
        <CardHead
          eyebrow="ROZPIS SMĚN"
          title={formatMonthLabel(cursor.year, cursor.month)}
          aside={
            <div className="calendar-toolbar">
              <button
                className="outline"
                onClick={() => {
                  const [y, m] = prevMonth(cursor.year, cursor.month);
                  setCursor({ year: y, month: m });
                  setSelectedDate(null);
                }}
              >
                ← Předchozí
              </button>
              <button
                className="outline"
                onClick={() => {
                  const [y, m] = nextMonth(cursor.year, cursor.month);
                  setCursor({ year: y, month: m });
                  setSelectedDate(null);
                }}
              >
                Další →
              </button>
            </div>
          }
        />
        {branches.length > 1 && (
          <section className="branch-tabs" aria-label="Výběr pobočky">
            {branches.map((branch) => (
              <button
                key={branch.id}
                className={selectedBranchId === branch.id ? "active" : ""}
                onClick={() => {
                  setSelectedBranchId(branch.id);
                  setSelectedDate(null);
                }}
              >
                <span>{branch.name.includes("Černá") ? "ČP" : "BB"}</span>
                <div>
                  <strong>{branch.name}</strong>
                </div>
              </button>
            ))}
          </section>
        )}
        <div className="filters">
          {(
            [
              ["all", "Vše"],
              ["bar", "Bar"],
              ["kuchyne", "Kuchyně"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={departmentFilter === value ? "active" : ""}
              onClick={() => setDepartmentFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="muted">Načítám směny…</p>
        ) : (
          <ShiftCalendarGrid
            year={cursor.year}
            month={cursor.month}
            shiftsByDate={shiftsByDate}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            userEmail={userEmail}
          />
        )}
      </section>
      {selectedDate && (
        <ShiftDayPanel
          key={selectedDate}
          date={selectedDate}
          shifts={dayShifts}
          editable={canManageShifts}
          roster={roster}
          userEmail={userEmail}
          onCreate={createShift}
          onDelete={deleteShift}
          saving={saving}
        />
      )}
    </>
  );
}

function ShiftCalendarGrid({
  year,
  month,
  shiftsByDate,
  selectedDate,
  onSelectDate,
  userEmail,
}: {
  year: number;
  month: number;
  shiftsByDate: Record<string, ShiftRow[]>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  userEmail: string;
}) {
  const grid = getMonthGrid(year, month);
  const weekdays = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
  return (
    <div className="calendar-grid">
      {weekdays.map((label, index) => (
        <div key={label} className={`weekday ${index >= 5 ? "weekend" : ""}`}>
          {label}
        </div>
      ))}
      {grid.map((cell) => {
        const dayShifts = shiftsByDate[cell.date] ?? [];
        return (
          <div
            key={cell.date}
            className={[
              "calendar-day",
              cell.isWeekend ? "weekend" : "",
              !cell.inMonth ? "other-month" : "",
              cell.isToday ? "today" : "",
              selectedDate === cell.date ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelectDate(cell.date)}
          >
            <b>{cell.day}</b>
            {dayShifts.slice(0, 3).map((shift) => (
              <span
                key={shift.id}
                className={[
                  "shift-chip",
                  shift.department,
                  shift.employeeEmail === userEmail.toLowerCase()
                    ? "mine"
                    : "",
                  shift.isPlaceholder ? "placeholder" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {shift.startTime}–{shift.endTime} {shift.employeeName.split(" ")[0]}
              </span>
            ))}
            {dayShifts.length > 3 && <small>+{dayShifts.length - 3} další</small>}
          </div>
        );
      })}
    </div>
  );
}

function ShiftDayPanel({
  date,
  shifts,
  editable,
  roster,
  userEmail,
  onCreate,
  onDelete,
  saving,
}: {
  date: string;
  shifts: ShiftRow[];
  editable: boolean;
  roster: RosterMember[];
  userEmail: string;
  onCreate: (draft: ShiftDraft) => Promise<void>;
  onDelete: (id: number) => void;
  saving: boolean;
}) {
  const [department, setDepartment] = useState<"bar" | "kuchyne">("bar");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"registered" | "new">("registered");
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<RosterMember | null>(
    null,
  );
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const filteredRoster = roster.filter((member) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      member.fullName.toLowerCase().includes(q) ||
      member.email.toLowerCase().includes(q)
    );
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (source === "registered") {
      if (!selectedMember) return;
      await onCreate({
        department,
        startTime,
        endTime,
        note,
        employeeSource: "registered",
        employeeUserId: selectedMember.userId,
      });
      setSelectedMember(null);
      setQuery("");
    } else {
      if (!newName.trim() || !newEmail.trim()) return;
      await onCreate({
        department,
        startTime,
        endTime,
        note,
        employeeSource: "new",
        employeeName: newName.trim(),
        employeeEmail: newEmail.trim(),
      });
      setNewName("");
      setNewEmail("");
    }
    setNote("");
  }

  const grouped = {
    bar: shifts.filter((s) => s.department === "bar"),
    kuchyne: shifts.filter((s) => s.department === "kuchyne"),
  };

  return (
    <section className="card action-form">
      <CardHead eyebrow="DEN" title={formatDayLabel(date)} />
      {(["bar", "kuchyne"] as const).map((dept) => (
        <div key={dept} className="shift-day-department">
          <h3>{dept === "bar" ? "Bar" : "Kuchyně"}</h3>
          {grouped[dept].length === 0 && <p className="muted">Žádná směna.</p>}
          {grouped[dept].map((shift) => (
            <div
              key={shift.id}
              className={[
                "shift-chip",
                dept,
                shift.employeeEmail === userEmail.toLowerCase() ? "mine" : "",
                shift.isPlaceholder ? "placeholder" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>
                {shift.startTime}–{shift.endTime} · {shift.employeeName}
                {shift.isPlaceholder ? " (nový zaměstnanec)" : ""}
              </span>
              {editable && (
                <button type="button" onClick={() => onDelete(shift.id)}>
                  Smazat
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {editable && (
        <form onSubmit={submit}>
          <div className="form-grid">
            <label>
              <span>Středisko</span>
              <select
                value={department}
                onChange={(event) =>
                  setDepartment(event.target.value as "bar" | "kuchyne")
                }
              >
                <option value="bar">Bar</option>
                <option value="kuchyne">Kuchyně</option>
              </select>
            </label>
            <label>
              <span>Od</span>
              <input
                type="time"
                required
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label>
              <span>Do</span>
              <input
                type="time"
                required
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </label>
            <label>
              <span>Poznámka</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Volitelné"
              />
            </label>
          </div>
          <div className="employee-source-toggle">
            <button
              type="button"
              className={source === "registered" ? "active" : ""}
              onClick={() => setSource("registered")}
            >
              Registrovaný zaměstnanec
            </button>
            <button
              type="button"
              className={source === "new" ? "active" : ""}
              onClick={() => setSource("new")}
            >
              + Nový zaměstnanec
            </button>
          </div>
          {source === "registered" ? (
            <>
              <input
                placeholder="Hledat jméno nebo e-mail"
                value={selectedMember ? selectedMember.fullName : query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedMember(null);
                }}
              />
              {!selectedMember && query && (
                <div className="employee-picker-results">
                  {filteredRoster.length === 0 && (
                    <span>Nikdo nenalezen.</span>
                  )}
                  {filteredRoster.map((member) => (
                    <button
                      type="button"
                      key={member.userId}
                      onClick={() => {
                        setSelectedMember(member);
                        setQuery(member.fullName);
                      }}
                    >
                      {member.fullName} · {member.email}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="form-grid">
              <label>
                <span>Jméno</span>
                <input
                  required
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <label>
                <span>E-mail</span>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </label>
            </div>
          )}
          <footer>
            <span>Směna se propíše zaměstnanci po přihlášení a schválení.</span>
            <button
              className="primary"
              disabled={saving || (source === "registered" && !selectedMember)}
            >
              Přidat směnu
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}

function Summary({ items }: { items: string[][] }) {
  return (
    <section className="summary">
      {items.map((item) => (
        <div key={item[0]}>
          <small>{item[0]}</small>
          <strong>{item[1]}</strong>
          <span>{item[2]}</span>
        </div>
      ))}
    </section>
  );
}

function audienceName(
  type: AudienceType,
  branchId: string | null | undefined,
  personName: string | null | undefined,
  branches: Branch[],
) {
  if (type === "company") return "Celá firma";
  if (type === "person") return personName || "Jednotlivec";
  return branches.find((branch) => branch.id === branchId)?.name || "Pobočka";
}

function Tasks({
  location,
  branches,
  tasks,
  assignedTasks,
  completion,
  toggleTask,
  createAssignedTask,
  completeAssignedTask,
}: {
  location: string;
  branches: Branch[];
  tasks: Task[];
  assignedTasks: AssignedTask[];
  completion: number;
  toggleTask: (id: number) => void;
  createAssignedTask: (draft: AssignedTaskDraft) => void;
  completeAssignedTask: (id: number) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("branch");
  const [recipient, setRecipient] = useState(branches[0]?.id || "");
  const [dueAt, setDueAt] = useState("2026-08-18T12:00");
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const scope = location.startsWith("Foodtab") ? "Všechny pobočky" : location;
  const selectedBranch = branches.find(
    (branch) => branch.name === location,
  )?.id;
  const visibleAssignedTasks = selectedBranch
    ? assignedTasks.filter(
        (task) =>
          task.audienceType === "company" ||
          task.targetBranchId === selectedBranch ||
          employees.some(
            (person) =>
              person.branchId === selectedBranch &&
              person.email === task.targetPersonEmail,
          ) ||
          task.originLocation === location,
      )
    : assignedTasks;
  function chooseAudience(next: AudienceType) {
    setAudienceType(next);
    setRecipient(
      next === "branch"
        ? branches[0]?.id || ""
        : next === "person"
          ? employees[0]?.email || ""
          : "",
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !dueAt) return;
    createAssignedTask({
      title: title.trim(),
      note: note.trim(),
      audienceType,
      recipient,
      dueAt,
      priority,
    });
    setTitle("");
    setNote("");
    setShowForm(false);
  }
  return (
    <>
      <Intro
        eyebrow="PROVOZ"
        title="Úkoly a checklisty"
        description="Zadávání úkolů centrálně, konkrétní pobočce i jednotlivým zaměstnancům."
        action={
          <button
            className="primary"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Zavřít formulář" : "+ Nový úkol"}
          </button>
        }
      />
      {showForm && (
        <section className="card action-form">
          <CardHead eyebrow="ZADÁNÍ" title="Nový provozní úkol" />
          <form onSubmit={submit}>
            <div className="form-grid">
              <label>
                <span>Název úkolu</span>
                <input
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Např. Objednat sudy Bernard"
                />
              </label>
              <label>
                <span>Termín</span>
                <input
                  required
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Podrobnosti</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Co přesně je potřeba udělat?"
              />
            </label>
            <div className="routing-row">
              <div>
                <span>Komu zadat</span>
                <div className="segmented">
                  {(["company", "branch", "person"] as AudienceType[]).map(
                    (type) => (
                      <button
                        type="button"
                        key={type}
                        className={audienceType === type ? "active" : ""}
                        onClick={() => chooseAudience(type)}
                      >
                        {type === "company"
                          ? "Celá firma"
                          : type === "branch"
                            ? "Pobočka"
                            : "Jednotlivec"}
                      </button>
                    ),
                  )}
                </div>
              </div>
              {audienceType !== "company" && (
                <label>
                  <span>
                    {audienceType === "branch" ? "Cílová pobočka" : "Řešitel"}
                  </span>
                  <select
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                  >
                    {audienceType === "branch"
                      ? branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))
                      : employees.map((person) => (
                          <option key={person.email} value={person.email}>
                            {person.name} · {person.role}
                          </option>
                        ))}
                  </select>
                </label>
              )}
              <label>
                <span>Priorita</span>
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as "normal" | "high")
                  }
                >
                  <option value="normal">Běžná</option>
                  <option value="high">Vysoká</option>
                </select>
              </label>
            </div>
            <footer>
              <span>Zadává: {location}</span>
              <button className="primary">Uložit a přidělit úkol</button>
            </footer>
          </form>
        </section>
      )}
      <Summary
        items={[
          ["SPLNĚNO", `${completion} %`, "dnešních checklistů"],
          [
            "ZADANÉ ÚKOLY",
            `${visibleAssignedTasks.filter((task) => !task.completed).length}`,
            scope,
          ],
          [
            "VYSOKÁ PRIORITA",
            `${visibleAssignedTasks.filter((task) => task.priority === "high" && !task.completed).length}`,
            "čeká na vyřízení",
          ],
        ]}
      />
      <section className="card wide assigned-board">
        <CardHead
          eyebrow="PŘIDĚLENÉ ÚKOLY"
          title={scope}
          aside={<span className="origin-note">Centrála i pobočky</span>}
        />
        <div className="assigned-list">
          {visibleAssignedTasks.length ? (
            visibleAssignedTasks.map((task) => (
              <label
                className={`assigned-row ${task.completed ? "done" : ""}`}
                key={task.id}
              >
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => completeAssignedTask(task.id)}
                />
                <i>✓</i>
                <div>
                  <header>
                    <strong>{task.title}</strong>
                    {task.priority === "high" && <b>VYSOKÁ</b>}
                  </header>
                  <p>{task.note || "Bez doplňující poznámky"}</p>
                  <small>
                    Od: {task.originLocation} · Pro:{" "}
                    {audienceName(
                      task.audienceType,
                      task.targetBranchId,
                      task.targetPersonName,
                      branches,
                    )}
                  </small>
                </div>
                <time>
                  {new Intl.DateTimeFormat("cs-CZ", {
                    day: "numeric",
                    month: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(task.dueAt))}
                </time>
              </label>
            ))
          ) : (
            <div className="empty-state">
              Pro tento výběr zatím nejsou žádné přidělené úkoly.
            </div>
          )}
        </div>
      </section>
      <section className="card wide checklist-board">
        <CardHead
          eyebrow="PRAVIDELNÉ CHECKLISTY"
          title={`${scope} · Pondělí`}
          aside={
            <div className="filters">
              <button className="active">Vše</button>
              <button>Kuchyně</button>
              <button>Bar</button>
              <button>Servis</button>
            </div>
          }
        />
        <div className="task-list large">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} toggle={toggleTask} />
          ))}
        </div>
        <Checklist
          label="RÁNO"
          title="Otevírací checklist"
          note="8 z 10 kroků hotovo"
          value={80}
        />
        <Checklist
          label="VEČER"
          title="Zavírací checklist"
          note="Začíná ve 21:30"
          value={0}
        />
      </section>
    </>
  );
}
function Checklist({
  label,
  title,
  note,
  value,
}: {
  label: string;
  title: string;
  note: string;
  value: number;
}) {
  return (
    <div className="checklist">
      <div>
        <span>{label}</span>
        <strong>{title}</strong>
        <small>{note}</small>
      </div>
      <div className="progress">
        <i style={{ width: `${value}%` }} />
      </div>
      <button>Otevřít checklist →</button>
    </div>
  );
}

function Communication({
  location,
  branches,
  posts,
  post,
  setPost,
  publish,
}: {
  location: string;
  branches: Branch[];
  posts: Post[];
  post: string;
  setPost: (value: string) => void;
  publish: (
    event: FormEvent,
    audienceType: AudienceType,
    recipient: string,
  ) => void;
}) {
  const [audienceType, setAudienceType] = useState<AudienceType>("company");
  const [recipient, setRecipient] = useState("");
  const [channel, setChannel] = useState("all");
  const filteredPosts = posts.filter(
    (item) =>
      channel === "all" ||
      (channel === "person" && item.audienceType === "person") ||
      item.targetBranchId === channel ||
      (channel === "company" && item.audienceType === "company"),
  );
  function chooseAudience(next: AudienceType) {
    setAudienceType(next);
    setRecipient(
      next === "branch"
        ? branches[0]?.id || ""
        : next === "person"
          ? employees[0]?.email || ""
          : "",
    );
  }
  return (
    <>
      <Intro
        eyebrow="TÝM"
        title="Komunikace"
        description="Zprávy z centrály, mezi pobočkami i přímo konkrétnímu zaměstnanci."
      />
      <div className="communication">
        <section className="card compose">
          <p>NOVÁ ZPRÁVA</p>
          <form onSubmit={(event) => publish(event, audienceType, recipient)}>
            <div className="message-route">
              <div>
                <span>Odesílatel</span>
                <strong>{location}</strong>
              </div>
              <div>
                <span>Komu zprávu poslat</span>
                <div className="segmented">
                  {(["company", "branch", "person"] as AudienceType[]).map(
                    (type) => (
                      <button
                        type="button"
                        key={type}
                        className={audienceType === type ? "active" : ""}
                        onClick={() => chooseAudience(type)}
                      >
                        {type === "company"
                          ? "Celá firma"
                          : type === "branch"
                            ? "Pobočka"
                            : "Jednotlivec"}
                      </button>
                    ),
                  )}
                </div>
              </div>
              {audienceType !== "company" && (
                <label>
                  <span>
                    {audienceType === "branch" ? "Cílová pobočka" : "Příjemce"}
                  </span>
                  <select
                    value={recipient}
                    required
                    onChange={(event) => setRecipient(event.target.value)}
                  >
                    {audienceType === "branch"
                      ? branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))
                      : employees.map((person) => (
                          <option key={person.email} value={person.email}>
                            {person.name} · {person.role}
                          </option>
                        ))}
                  </select>
                </label>
              )}
            </div>
            <textarea
              value={post}
              required
              onChange={(event) => setPost(event.target.value)}
              placeholder="Napište oznámení nebo přímý vzkaz…"
            />
            <footer>
              <span>
                Adresát:{" "}
                {audienceName(
                  audienceType,
                  audienceType === "branch" ? recipient : null,
                  employees.find((person) => person.email === recipient)?.name,
                  branches,
                )}
              </span>
              <button className="primary">Odeslat zprávu</button>
            </footer>
          </form>
        </section>
        <aside className="card channels">
          <p>KANÁLY A PŘÍJEMCI</p>
          <button
            className={channel === "all" ? "active" : ""}
            onClick={() => setChannel("all")}
          >
            <span>V</span>Všechny zprávy<b>{posts.length}</b>
          </button>
          <button
            className={channel === "company" ? "active" : ""}
            onClick={() => setChannel("company")}
          >
            <span>F</span>Celá firma
          </button>
          {branches.map((branch) => (
            <button
              key={branch.id}
              className={channel === branch.id ? "active" : ""}
              onClick={() => setChannel(branch.id)}
            >
              <span>{branch.name.includes("Černá") ? "ČP" : "BB"}</span>
              {branch.name}
            </button>
          ))}
          <button
            className={channel === "person" ? "active" : ""}
            onClick={() => setChannel("person")}
          >
            <span>1</span>Osobní zprávy
          </button>
        </aside>
        <section className="feed">
          {filteredPosts.map((item) => (
            <article className="card" key={item.id}>
              <i>
                {item.author
                  .split(" ")
                  .map((word) => word[0])
                  .join("")
                  .slice(0, 2)}
              </i>
              <div>
                <header>
                  <strong>{item.author}</strong>
                  <span>
                    {item.role} · {item.time}
                  </span>
                </header>
                <div className="route-badge">
                  <span>Od: {item.originLocation}</span>
                  <b>→</b>
                  <span>
                    Pro:{" "}
                    {audienceName(
                      item.audienceType,
                      item.targetBranchId,
                      item.targetPersonName,
                      branches,
                    )}
                  </span>
                </div>
                <p>{item.text}</p>
                <footer>
                  <button>♡ Užitečné</button>
                  <button>Odpovědět</button>
                  <span>
                    {item.audienceType === "person"
                      ? "Soukromá zpráva"
                      : "Doručeno"}
                  </span>
                </footer>
              </div>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}

function Recipes({
  location,
  branches,
  recipes,
  createRecipe,
}: {
  location: string;
  branches: Branch[];
  recipes: Recipe[];
  createRecipe: (draft: RecipeDraft) => void;
}) {
  const locationBranchId = branches.find(
    (branch) => branch.name === location,
  )?.id;
  const [selectedBranchId, setSelectedBranchId] = useState(
    locationBranchId || branches[0]?.id || "",
  );
  const [showForm, setShowForm] = useState(false);
  const [openRecipe, setOpenRecipe] = useState<number | null>(null);
  const [draft, setDraft] = useState<RecipeDraft>({
    branchId: locationBranchId || branches[0]?.id || "",
    name: "",
    category: "Hlavní jídlo",
    portions: 10,
    allergens: "",
    ingredients: "",
    instructions: "",
  });
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedBranchId,
  );
  const visibleRecipes = recipes.filter(
    (recipe) => recipe.branchId === selectedBranchId,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    createRecipe({ ...draft, branchId: draft.branchId || selectedBranchId });
    setDraft((current) => ({
      ...current,
      name: "",
      allergens: "",
      ingredients: "",
      instructions: "",
    }));
    setShowForm(false);
  }
  return (
    <>
      <Intro
        eyebrow="KUCHYNĚ A BAR"
        title="Recepty poboček"
        description="Každá provozovna má vlastní receptury, gramáže, postupy a přehled alergenů."
        action={
          <button
            className="primary"
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Zavřít formulář" : "+ Přidat recept"}
          </button>
        }
      />
      <section className="branch-tabs" aria-label="Výběr pobočky">
        {branches.map((branch) => (
          <button
            key={branch.id}
            className={selectedBranchId === branch.id ? "active" : ""}
            onClick={() => {
              setSelectedBranchId(branch.id);
              setDraft((current) => ({ ...current, branchId: branch.id }));
            }}
          >
            <span>{branch.name.includes("Černá") ? "ČP" : "BB"}</span>
            <div>
              <strong>{branch.name}</strong>
              <small>
                {
                  recipes.filter((recipe) => recipe.branchId === branch.id)
                    .length
                }{" "}
                recepty
              </small>
            </div>
          </button>
        ))}
      </section>
      {showForm && (
        <section className="card action-form recipe-form">
          <CardHead eyebrow="NOVÁ RECEPTURA" title="Přidat recept k pobočce" />
          <form onSubmit={submit}>
            <div className="form-grid">
              <label>
                <span>Pobočka</span>
                <select
                  value={draft.branchId}
                  onChange={(event) =>
                    setDraft({ ...draft, branchId: event.target.value })
                  }
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Název receptu</span>
                <input
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Např. Hovězí líčka"
                />
              </label>
              <label>
                <span>Kategorie</span>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value })
                  }
                >
                  <option>Hlavní jídlo</option>
                  <option>Předkrm</option>
                  <option>Polévka</option>
                  <option>Dezert</option>
                  <option>K pivu</option>
                  <option>Nápoj</option>
                </select>
              </label>
              <label>
                <span>Počet porcí</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={draft.portions}
                  onChange={(event) =>
                    setDraft({ ...draft, portions: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                <span>Alergeny</span>
                <input
                  value={draft.allergens}
                  onChange={(event) =>
                    setDraft({ ...draft, allergens: event.target.value })
                  }
                  placeholder="Např. 1, 3, 7"
                />
              </label>
            </div>
            <div className="recipe-textareas">
              <label>
                <span>Suroviny a gramáže</span>
                <textarea
                  required
                  value={draft.ingredients}
                  onChange={(event) =>
                    setDraft({ ...draft, ingredients: event.target.value })
                  }
                  placeholder="Každou surovinu napište na nový řádek"
                />
              </label>
              <label>
                <span>Pracovní postup</span>
                <textarea
                  required
                  value={draft.instructions}
                  onChange={(event) =>
                    setDraft({ ...draft, instructions: event.target.value })
                  }
                  placeholder="Popište jednotlivé kroky přípravy"
                />
              </label>
            </div>
            <footer>
              <span>Recept se uloží pouze k vybrané pobočce.</span>
              <button className="primary">Uložit recept</button>
            </footer>
          </form>
        </section>
      )}
      <section className="recipe-summary">
        <div className="card">
          <small>VYBRANÁ POBOČKA</small>
          <strong>{selectedBranch?.name}</strong>
          <span>Samostatná kniha receptur</span>
        </div>
        <div className="card">
          <small>POČET RECEPTŮ</small>
          <strong>{visibleRecipes.length}</strong>
          <span>v této pobočce</span>
        </div>
        <div className="card">
          <small>ALERGENY</small>
          <strong>
            {
              new Set(
                visibleRecipes.flatMap((recipe) =>
                  recipe.allergens
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                ),
              ).size
            }
          </strong>
          <span>různých označení</span>
        </div>
      </section>
      <section className="recipe-grid">
        {visibleRecipes.map((recipe) => (
          <article
            className={`card recipe-card ${openRecipe === recipe.id ? "open" : ""}`}
            key={recipe.id}
          >
            <header>
              <span>{recipe.category.slice(0, 2).toUpperCase()}</span>
              <div>
                <small>{recipe.category}</small>
                <h2>{recipe.name}</h2>
              </div>
            </header>
            <div className="recipe-meta">
              <span>{recipe.portions} porcí</span>
              <span>Alergeny: {recipe.allergens || "neuvedeny"}</span>
            </div>
            {openRecipe === recipe.id && (
              <div className="recipe-detail">
                <div>
                  <strong>Suroviny</strong>
                  <p>{recipe.ingredients}</p>
                </div>
                <div>
                  <strong>Postup</strong>
                  <p>{recipe.instructions}</p>
                </div>
              </div>
            )}
            <footer>
              <small>{selectedBranch?.name}</small>
              <button
                onClick={() =>
                  setOpenRecipe(openRecipe === recipe.id ? null : recipe.id)
                }
              >
                {openRecipe === recipe.id ? "Skrýt recept" : "Otevřít recept →"}
              </button>
            </footer>
          </article>
        ))}
      </section>
    </>
  );
}

function Menus({
  location,
  branches,
  menuItems,
  weeklyMenus,
  createMenuItem,
  registerWeeklyMenu,
  apiFetch,
}: {
  location: string;
  branches: Branch[];
  menuItems: MenuItem[];
  weeklyMenus: WeeklyMenuDocument[];
  createMenuItem: (draft: MenuItemDraft) => void;
  registerWeeklyMenu: (document: WeeklyMenuDocument) => void;
  apiFetch: AuthorizedFetch;
}) {
  const locationBranchId = branches.find(
    (branch) => branch.name === location,
  )?.id;
  const [selectedBranchId, setSelectedBranchId] = useState(
    locationBranchId || branches[0]?.id || "",
  );
  const [showPermanentForm, setShowPermanentForm] = useState(false);
  const [draft, setDraft] = useState<MenuItemDraft>({
    branchId: locationBranchId || branches[0]?.id || "",
    menuType: "permanent",
    name: "",
    description: "",
    category: "Hlavní jídlo",
    price: 0,
    allergens: "",
    dayLabel: "",
  });
  const [source, setSource] = useState<"dashboard" | "ai_agent">("dashboard");
  const [weekLabel, setWeekLabel] = useState("18.–22. srpna 2026");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const selectedBranch = branches.find(
    (branch) => branch.id === selectedBranchId,
  );
  const permanentItems = menuItems.filter(
    (item) =>
      item.branchId === selectedBranchId &&
      item.menuType === "permanent" &&
      item.active,
  );
  const branchDocuments = weeklyMenus.filter(
    (document) => document.branchId === selectedBranchId,
  );
  const currentDocument =
    branchDocuments.find((document) => document.active) || branchDocuments[0];
  const olderDocuments = branchDocuments
    .filter((document) => document.id !== currentDocument?.id)
    .slice(0, 4);
  function openPermanentForm() {
    setShowPermanentForm(true);
    setDraft({
      branchId: selectedBranchId,
      menuType: "permanent",
      name: "",
      description: "",
      category: "Hlavní jídlo",
      price: 0,
      allergens: "",
      dayLabel: "",
    });
  }
  function submitPermanent(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || draft.price < 1) return;
    createMenuItem({
      ...draft,
      branchId: selectedBranchId,
      menuType: "permanent",
      dayLabel: "",
    });
    setShowPermanentForm(false);
  }
  async function uploadPdf(event: FormEvent) {
    event.preventDefault();
    if (!pdfFile || !weekLabel.trim()) return;
    setUploading(true);
    setUploadError("");
    const form = new FormData();
    form.set("file", pdfFile);
    form.set("branchId", selectedBranchId);
    form.set("weekLabel", weekLabel.trim());
    form.set("source", source);
    try {
      const response = await apiFetch("/api/menu-pdf", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        document?: WeeklyMenuDocument;
        error?: string;
      };
      if (!response.ok || !data.document)
        throw new Error(data.error || "PDF se nepodařilo nahrát.");
      registerWeeklyMenu(data.document);
      setPdfFile(null);
      setFileInputKey((value) => value + 1);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "PDF se nepodařilo nahrát.",
      );
    } finally {
      setUploading(false);
    }
  }
  async function openPdf(id: number) {
    setUploadError("");
    try {
      const response = await apiFetch(`/api/menu-pdf?id=${id}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "PDF se nepodařilo otevřít.");
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "PDF se nepodařilo otevřít.",
      );
    }
  }
  return (
    <>
      <Intro
        eyebrow="NABÍDKA PRO HOSTY"
        title="Jídelní lístky poboček"
        description="Stálý lístek se spravuje v dashboardu. Týdenní menu se zveřejňuje jako PDF z dashboardu nebo přes AI agenta."
      />
      <section className="branch-tabs" aria-label="Výběr pobočky">
        {branches.map((branch) => {
          const currentPdf = weeklyMenus.find(
            (document) => document.branchId === branch.id && document.active,
          );
          return (
            <button
              key={branch.id}
              className={selectedBranchId === branch.id ? "active" : ""}
              onClick={() => {
                setSelectedBranchId(branch.id);
                setShowPermanentForm(false);
                setUploadError("");
              }}
            >
              <span>{branch.name.includes("Černá") ? "ČP" : "BB"}</span>
              <div>
                <strong>{branch.name}</strong>
                <small>
                  {
                    menuItems.filter(
                      (item) =>
                        item.branchId === branch.id &&
                        item.menuType === "permanent",
                    ).length
                  }{" "}
                  stálých položek ·{" "}
                  {currentPdf ? "PDF menu aktivní" : "PDF zatím chybí"}
                </small>
              </div>
            </button>
          );
        })}
      </section>
      {showPermanentForm && (
        <section className="card action-form menu-item-form">
          <CardHead
            eyebrow="STÁLÝ JÍDELNÍ LÍSTEK"
            title="Přidat položku z dashboardu"
          />
          <form onSubmit={submitPermanent}>
            <div className="form-grid menu-form-grid">
              <label>
                <span>Pobočka</span>
                <input value={selectedBranch?.name || ""} readOnly />
              </label>
              <label>
                <span>Název jídla</span>
                <input
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="Např. Svíčková na smetaně"
                />
              </label>
              <label>
                <span>Kategorie</span>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value })
                  }
                >
                  <option>Hlavní jídlo</option>
                  <option>Předkrm</option>
                  <option>Polévka</option>
                  <option>Dezert</option>
                  <option>K pivu</option>
                  <option>Nápoj</option>
                </select>
              </label>
              <label>
                <span>Cena v Kč</span>
                <input
                  required
                  type="number"
                  min="1"
                  value={draft.price || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, price: Number(event.target.value) })
                  }
                  placeholder="189"
                />
              </label>
              <label>
                <span>Alergeny</span>
                <input
                  value={draft.allergens}
                  onChange={(event) =>
                    setDraft({ ...draft, allergens: event.target.value })
                  }
                  placeholder="Např. 1, 3, 7"
                />
              </label>
            </div>
            <label>
              <span>Popis pro hosta</span>
              <textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Příloha, omáčka nebo krátké upřesnění nabídky"
              />
            </label>
            <footer>
              <button
                type="button"
                className="outline"
                onClick={() => setShowPermanentForm(false)}
              >
                Zrušit
              </button>
              <button className="primary">Uložit do stálého lístku</button>
            </footer>
          </form>
        </section>
      )}
      <section className="menu-cards split-menu-cards">
        <article className="card menu-sheet permanent">
          <header>
            <div>
              <span>SEKCE 1 · SPRÁVA V DASHBOARDU</span>
              <h2>Stálý jídelní lístek</h2>
              <small>
                Položky lze nahrávat a upravovat pouze zde v dashboardu.
              </small>
            </div>
            <button className="outline" onClick={openPermanentForm}>
              + Přidat položku
            </button>
          </header>
          <div className="menu-sheet-list">
            {permanentItems.length ? (
              permanentItems.map((item) => (
                <div className="menu-line" key={item.id}>
                  <div>
                    <small>{item.category}</small>
                    <strong>{item.name}</strong>
                    <p>{item.description}</p>
                    <em>Alergeny: {item.allergens || "neuvedeny"}</em>
                  </div>
                  <span>{item.price} Kč</span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                Stálý jídelní lístek je zatím prázdný.
              </div>
            )}
          </div>
          <footer>
            <span>{permanentItems.length} položek</span>
            <strong>{selectedBranch?.name}</strong>
          </footer>
        </article>
        <article className="card menu-sheet weekly pdf-menu-sheet">
          <header>
            <div>
              <span>SEKCE 2 · PDF DOKUMENT</span>
              <h2>Týdenní menu</h2>
              <small>Aktuální menu se zveřejňuje výhradně jako PDF.</small>
            </div>
            {currentDocument && (
              <button
                type="button"
                className="outline"
                onClick={() => openPdf(currentDocument.id)}
              >
                Otevřít PDF
              </button>
            )}
          </header>
          <div className="pdf-menu-content">
            {currentDocument ? (
              <section className="current-pdf">
                <span>PDF</span>
                <div>
                  <small>AKTUÁLNÍ MENU</small>
                  <strong>{currentDocument.weekLabel}</strong>
                  <p>{currentDocument.fileName}</p>
                  <em>
                    {currentDocument.source === "ai_agent"
                      ? "Nahráno AI agentem"
                      : "Nahráno z dashboardu"}{" "}
                    · {(currentDocument.fileSize / 1024).toFixed(0)} kB
                  </em>
                </div>
              </section>
            ) : (
              <div className="empty-pdf">
                <span>PDF</span>
                <strong>Zatím není zveřejněné žádné týdenní menu.</strong>
              </div>
            )}
            <form className="pdf-upload-form" onSubmit={uploadPdf}>
              <div>
                <span>Způsob nahrání</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={source === "dashboard" ? "active" : ""}
                    onClick={() => setSource("dashboard")}
                  >
                    Z dashboardu
                  </button>
                  <button
                    type="button"
                    className={source === "ai_agent" ? "active" : ""}
                    onClick={() => setSource("ai_agent")}
                  >
                    Pomocí AI agenta
                  </button>
                </div>
              </div>
              <label>
                <span>Platnost menu</span>
                <input
                  required
                  value={weekLabel}
                  onChange={(event) => setWeekLabel(event.target.value)}
                />
              </label>
              <label className="pdf-drop">
                <input
                  key={fileInputKey}
                  required
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) =>
                    setPdfFile(event.target.files?.[0] || null)
                  }
                />
                <span>PDF</span>
                <div>
                  <strong>
                    {pdfFile
                      ? pdfFile.name
                      : source === "ai_agent"
                        ? "Vybrat PDF připravené AI agentem"
                        : "Vybrat PDF z počítače"}
                  </strong>
                  <small>Platný PDF dokument · maximálně 10 MB</small>
                </div>
              </label>
              {source === "ai_agent" && (
                <p className="agent-note">
                  <b>AI</b> Tato cesta označí dokument jako vložený AI agentem.
                  Agent používá stejný zabezpečený kanál a PDF se po předání
                  automaticky stane aktuálním menu.
                </p>
              )}
              {uploadError && <p className="upload-error">{uploadError}</p>}
              <button className="primary" disabled={uploading || !pdfFile}>
                {uploading ? "Nahrávám PDF…" : "Nahrát a zveřejnit PDF"}
              </button>
            </form>
            {olderDocuments.length > 0 && (
              <section className="pdf-history">
                <small>HISTORIE PDF</small>
                {olderDocuments.map((document) => (
                  <button
                    type="button"
                    key={document.id}
                    onClick={() => openPdf(document.id)}
                  >
                    <span>{document.weekLabel}</span>
                    <b>
                      {document.source === "ai_agent"
                        ? "AI agent"
                        : "Dashboard"}
                    </b>
                  </button>
                ))}
              </section>
            )}
          </div>
          <footer>
            <span>{branchDocuments.length} uložených PDF</span>
            <strong>{selectedBranch?.name}</strong>
          </footer>
        </article>
      </section>
    </>
  );
}

function GastroAi({
  messages,
  question,
  setQuestion,
  ask,
}: {
  messages: AiMessage[];
  question: string;
  setQuestion: (value: string) => void;
  ask: (event: FormEvent) => void;
}) {
  return (
    <>
      <Intro
        eyebrow="FIREMNÍ ZNALOSTI"
        title="Gastro AI"
        description="Ověřené rady z receptur, manuálů a standardů Foodtab."
      />
      <div className="ai-grid">
        <section className="card ai-chat">
          <header>
            <span className="ai-orb">AI</span>
            <div>
              <strong>Foodtab Gastro AI</strong>
              <small>
                <i /> Připraveno · 42 zdrojů
              </small>
            </div>
            <button>Vymazat konverzaci</button>
          </header>
          <div className="messages">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.from}`}>
                {message.from === "assistant" && (
                  <span className="ai-orb small">AI</span>
                )}
                <div>
                  <p>{message.text}</p>
                  {message.source && <button>▤ {message.source}</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="prompts">
            <button
              onClick={() => setQuestion("Jak správně řešit reklamaci hosta?")}
            >
              Reklamace hosta
            </button>
            <button
              onClick={() => setQuestion("Jak správně načepovat pivo Bernard?")}
            >
              Čepování piva
            </button>
            <button onClick={() => setQuestion("Jak ověřit alergeny v jídle?")}>
              Alergeny
            </button>
          </div>
          <form className="ai-form" onSubmit={ask}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Zeptej se na provoz, recepturu nebo situaci s hostem…"
            />
            <button aria-label="Odeslat">↑</button>
            <small>
              AI může udělat chybu. Důležité informace ověř ve zdroji.
            </small>
          </form>
        </section>
        <aside className="ai-side">
          <section className="card">
            <p>RYCHLÝ PŘÍSTUP</p>
            {[
              "Provozní standardy",
              "Receptury a alergeny",
              "Bernard manuál",
              "Péče o hosta",
              "HACCP a hygiena",
            ].map((item, index) => (
              <button key={item}>
                <span>{["PS", "RA", "BE", "PH", "HA"][index]}</span>
                {item}
                <b>→</b>
              </button>
            ))}
          </section>
          <section className="card tip">
            <span>TIP DNE</span>
            <h3>Umíš se zeptat i přirozeně</h3>
            <p>„Host tvrdí, že má v jídle alergen. Jak mám postupovat?“</p>
          </section>
        </aside>
      </div>
    </>
  );
}

function Motivation() {
  return (
    <>
      <Intro
        eyebrow="LIDÉ"
        title="Tým a motivace"
        description="Oceňujte dobrou práci, sledujte rozvoj a slavte týmové úspěchy."
        action={<button className="primary">+ Udělit pochvalu</button>}
      />
      <section className="challenge">
        <div>
          <span>MĚSÍČNÍ VÝZVA · SRPEN</span>
          <h2>Dokonalý servis, každý den</h2>
          <p>
            Společně splňte 95 % provozních checklistů a získejte týmovou
            večeři.
          </p>
          <div className="progress">
            <i style={{ width: "82%" }} />
          </div>
          <small>82 % · zbývá 14 dní</small>
        </div>
        <strong>
          82<small>%</small>
        </strong>
      </section>
      <div className="two-column">
        <section className="card leaderboard">
          <CardHead eyebrow="TENTO MĚSÍC" title="Žebříček pochval" />
          {people.map((person, index) => (
            <div className="leader" key={person[0]}>
              <span>{index + 1}</span>
              <i>{person[4]}</i>
              <div>
                <strong>{person[0]}</strong>
                <small>{person[1]}</small>
              </div>
              <b>
                {person[2]} bodů<small>{person[3]} tento týden</small>
              </b>
            </div>
          ))}
        </section>
        <section className="card rewards">
          <CardHead eyebrow="ODMĚNY" title="Co si tým může vybrat" />
          {[
            ["500", "Káva a dezert", "350 b."],
            ["1000", "Večeře pro dva", "1 200 b."],
            ["VOLNO", "Půlden volna", "2 500 b."],
          ].map((reward) => (
            <div className="reward" key={reward[1]}>
              <span>{reward[0]}</span>
              <div>
                <strong>{reward[1]}</strong>
                <small>{reward[2]}</small>
              </div>
              <button>Vybrat</button>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function CompanyFinance() {
  return (
    <>
      <Intro
        eyebrow="FOODTAB S.R.O. · FINANCE"
        title="Finance a výsledky"
        description="Přehled firmy i jednotlivých poboček. Hodnoty jsou zatím ukázkové pro ověření prototypu."
        action={<button className="outline">Exportovat přehled</button>}
      />
      <section className="report-metrics">
        {[
          ["TRŽBY SRPEN", "1,26 mil. Kč", "↗ 8,4 % proti červenci"],
          ["PROVOZNÍ VÝSLEDEK", "214 600 Kč", "marže 17,0 %"],
          ["PERSONÁLNÍ NÁKLADY", "26,9 %", "cíl pod 30 %"],
          ["PENÍZE NA ÚČTECH", "486 200 Kč", "po odečtení závazků"],
        ].map((item) => (
          <div className="card" key={item[0]}>
            <small>{item[0]}</small>
            <strong>{item[1]}</strong>
            <span>{item[2]}</span>
          </div>
        ))}
      </section>
      <div className="finance-layout">
        <section className="card wide chart-card">
          <CardHead
            eyebrow="POSLEDNÍCH 14 DNÍ"
            title="Tržby Černé Perly"
            aside={
              <div className="filters">
                <button className="active">Tržby</button>
                <button>Plán</button>
              </div>
            }
          />
          <div className="chart">
            <div>
              {[42, 55, 48, 72, 66, 38, 52, 68, 76, 62, 84, 70, 92, 78].map(
                (height, index) => (
                  <i style={{ height: `${height}%` }} key={index} />
                ),
              )}
            </div>
            <footer>
              <span>4. 8.</span>
              <span>8. 8.</span>
              <span>12. 8.</span>
              <span>17. 8.</span>
            </footer>
          </div>
        </section>
        <section className="card obligations">
          <CardHead eyebrow="ZÁVAZKY" title="Nejbližší platby" />
          {[
            ["18. 8.", "Bernard a.s.", "28 460 Kč"],
            ["19. 8.", "Makro ČR", "21 820 Kč"],
            ["20. 8.", "Energie", "14 000 Kč"],
          ].map((row) => (
            <div key={row[1]}>
              <span>{row[0]}</span>
              <strong>{row[1]}</strong>
              <b>{row[2]}</b>
            </div>
          ))}
          <footer>
            <span>Celkem ke schválení</span>
            <strong>64 280 Kč</strong>
          </footer>
        </section>
      </div>
      <section className="card wide branch-finance">
        <CardHead eyebrow="VÝSLEDKY PO POBOČKÁCH" title="Srovnání provozoven" />
        <div className="data-table">
          <header>
            <span>Pobočka</span>
            <span>Tržby</span>
            <span>Náklady</span>
            <span>Výsledek</span>
          </header>
          <div>
            <span>
              <b>Restaurace Černá Perla</b>
            </span>
            <span>744 800 Kč</span>
            <span>625 100 Kč</span>
            <span className="positive-value">+ 119 700 Kč</span>
          </div>
          <div>
            <span>
              <b>Bernard Bar Tábor</b>
            </span>
            <span>520 000 Kč</span>
            <span>425 100 Kč</span>
            <span className="positive-value">+ 94 900 Kč</span>
          </div>
        </div>
      </section>
    </>
  );
}

function AppManagement({ branchCount }: { branchCount: number }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "Směny a docházka": true,
    "Úkoly a checklisty": true,
    Komunikace: true,
    Recepty: true,
    "Jídelní lístky": true,
    "Gastro AI": true,
    "Motivační systém": true,
    "Finanční přehled": true,
  });
  const modules = [
    [
      "DO",
      "Směny a docházka",
      "Plánování směn, příchody, odchody a podklady pro mzdy",
      "Všichni zaměstnanci",
    ],
    [
      "ÚK",
      "Úkoly a checklisty",
      "Centrální, pobočkové a osobní úkoly včetně termínů",
      "Provozní tým",
    ],
    [
      "KO",
      "Komunikace",
      "Zprávy centrály, mezi pobočkami i jednotlivcům",
      "Všichni zaměstnanci",
    ],
    [
      "RE",
      "Recepty",
      "Samostatná kniha receptur, gramáží a alergenů pro každou pobočku",
      "Kuchyně a vedení",
    ],
    [
      "JL",
      "Jídelní lístky",
      "Stálý jídelní lístek a týdenní menu zvlášť pro každou pobočku",
      "Vedení a provozní",
    ],
    [
      "AI",
      "Gastro AI",
      "Firemní znalosti, receptury, školení a provozní rady",
      "Všichni zaměstnanci",
    ],
    [
      "MO",
      "Motivační systém",
      "Pochvaly, body, týmové cíle a odměny",
      "Vedení a tým",
    ],
    [
      "FI",
      "Finanční přehled",
      "Tržby, náklady, závazky a výsledky poboček",
      "Pouze vedení",
    ],
  ];
  return (
    <>
      <Intro
        eyebrow="FOODTAB S.R.O. · KONFIGURACE"
        title="Aplikace a moduly"
        description="Zapněte každé pobočce jen funkce, které skutečně používá."
        action={<button className="primary">+ Vlastní modul</button>}
      />
      <section className="module-summary">
        <div>
          <strong>{Object.values(enabled).filter(Boolean).length}</strong>
          <span>aktivních modulů</span>
        </div>
        <div>
          <strong>{branchCount}</strong>
          <span>připojené pobočky</span>
        </div>
        <div>
          <strong>18</strong>
          <span>uživatelských účtů</span>
        </div>
      </section>
      <section className="module-grid">
        {modules.map((module) => (
          <article className="card module-card" key={module[1]}>
            <header>
              <span>{module[0]}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={enabled[module[1]]}
                  onChange={() =>
                    setEnabled((current) => ({
                      ...current,
                      [module[1]]: !current[module[1]],
                    }))
                  }
                />
                <i />
              </label>
            </header>
            <h2>{module[1]}</h2>
            <p>{module[2]}</p>
            <footer>
              <span>{module[3]}</span>
              <button>Nastavit →</button>
            </footer>
          </article>
        ))}
      </section>
    </>
  );
}

function AccessManagement({
  branches,
  apiFetch,
}: {
  branches: Branch[];
  apiFetch: AuthorizedFetch;
}) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/access", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as {
          users?: AccessUser[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || "Žádosti se nepodařilo načíst.");
        if (!cancelled) setUsers(data.users ?? []);
      })
      .catch(
        (reason: unknown) =>
          !cancelled &&
          setError(
            reason instanceof Error
              ? reason.message
              : "Žádosti se nepodařilo načíst.",
          ),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  async function review(
    id: string,
    decision: "approved" | "rejected" | "suspended",
    branchId?: string,
    role?: string,
    permissions?: string[],
  ) {
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "review",
          id,
          decision,
          branchId,
          role,
          permissions,
        }),
      });
      const data = (await response.json()) as {
        user?: AccessUser;
        error?: string;
      };
      if (!response.ok || !data.user)
        throw new Error(data.error || "Rozhodnutí se nepodařilo uložit.");
      setUsers((current) =>
        current.map((item) =>
          item.id === id ? (data.user as AccessUser) : item,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Rozhodnutí se nepodařilo uložit.",
      );
    } finally {
      setSaving(false);
    }
  }

  const pending = users.filter((user) => user.status === "pending");
  const approved = users.filter((user) => user.status === "approved");
  const disabled = users.filter(
    (user) => user.status === "rejected" || user.status === "suspended",
  );

  return (
    <>
      <Intro
        eyebrow="FOODTAB S.R.O. · SCHVALOVÁNÍ PŘÍSTUPŮ"
        title="Uživatelé a přístupy"
        description="Zaměstnanec se ověří vlastním účtem. Až po vašem schválení získá pobočku, pracovní roli a povolené moduly."
      />
      <section
        className="access-flow card"
        aria-label="Postup schválení přístupu"
      >
        <div>
          <span>1</span>
          <strong>
            Ověření identity<small>E-mailový odkaz, Google nebo Apple</small>
          </strong>
        </div>
        <b>→</b>
        <div>
          <span>2</span>
          <strong>
            Čekající žádost<small>Bez přístupu k firemním datům</small>
          </strong>
        </div>
        <b>→</b>
        <div>
          <span>3</span>
          <strong>
            Vaše schválení<small>Pobočka, role a jednotlivé moduly</small>
          </strong>
        </div>
      </section>
      <section className="security-notice card">
        <span>✓</span>
        <div>
          <strong>Bezpečný princip „nejdřív schválit“</strong>
          <p>
            Samotné ověření e-mailu nebo sociálního účtu uživateli nezpřístupní
            provozní data. Nový účet zůstane ve stavu Čeká na schválení.
          </p>
        </div>
      </section>
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      <section className="access-overview">
        <div className="card">
          <small>ČEKAJÍCÍ ŽÁDOSTI</small>
          <strong>{pending.length}</strong>
          <span>vyžadují rozhodnutí</span>
        </div>
        <div className="card">
          <small>AKTIVNÍ UŽIVATELÉ</small>
          <strong>{approved.length}</strong>
          <span>se schválenými právy</span>
        </div>
        <div className="card">
          <small>POZASTAVENÉ / ZAMÍTNUTÉ</small>
          <strong>{disabled.length}</strong>
          <span>bez přístupu k datům</span>
        </div>
        <div className="card security-card">
          <small>REŽIM APLIKACE</small>
          <strong>Soukromý</strong>
          <span>Supabase Auth a schvalování aktivní</span>
        </div>
      </section>
      <section className="card wide access-requests">
        <CardHead
          eyebrow="NOVÍ UŽIVATELÉ"
          title="Žádosti čekající na schválení"
          aside={<span className="status">{pending.length} čeká</span>}
        />
        {loading ? (
          <div className="empty-state">Načítám žádosti…</div>
        ) : pending.length === 0 ? (
          <div className="empty-state">
            <strong>Žádná žádost zatím nečeká.</strong>
            <span>
              Nová žádost se zde objeví automaticky po prvním přihlášení
              zaměstnance.
            </span>
          </div>
        ) : (
          <div className="request-list">
            {pending.map((user) => (
              <AccessRequestCard
                key={user.id}
                user={user}
                branches={branches}
                saving={saving}
                onReview={review}
              />
            ))}
          </div>
        )}
      </section>
      <div className="access-layout">
        <section className="card wide user-table">
          <CardHead eyebrow="SCHVÁLENÉ ÚČTY" title="Aktivní uživatelé" />
          <div className="approved-users">
            {approved.length === 0 ? (
              <div className="empty-state">
                Po schválení se zde zobrazí aktivní účty.
              </div>
            ) : (
              approved.map((user) => (
                <div key={user.id}>
                  <i>{initials(user.fullName)}</i>
                  <div>
                    <strong>{user.fullName}</strong>
                    <small>{user.email}</small>
                  </div>
                  <span>
                    {branchName(user.branchId, branches)} ·{" "}
                    {roleName(user.role)}
                  </span>
                  <b className="active-user">Aktivní</b>
                  <button
                    disabled={saving}
                    onClick={() => review(user.id, "suspended")}
                  >
                    Pozastavit
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
        <aside className="card login-policy">
          <CardHead eyebrow="ZPŮSOBY OVĚŘENÍ" title="Přihlašování" />
          <div>
            <span>
              <i>✉</i>
              <b>
                Přihlašovací odkaz<small>Základní možnost pro každý e-mail</small>
              </b>
            </span>
            <strong>Vybráno</strong>
          </div>
          <div>
            <span>
              <i>G</i>
              <b>
                Google účet<small>Pohodlné přihlášení jedním klepnutím</small>
              </b>
            </span>
            <strong>Nastavit</strong>
          </div>
          <div>
            <span>
              <i></i>
              <b>
                Apple účet<small>Pro uživatele iPhonu</small>
              </b>
            </span>
            <strong>Nastavit</strong>
          </div>
          <p className="provider-note">
            <b>Supabase Auth:</b> e-mailové ověření je zapojené. Google a Apple
            budou aktivní po vložení údajů poskytovatelů v nastavení projektu.
            Hesla se ve Foodtabu neukládají.
          </p>
        </aside>
      </div>
    </>
  );
}

function AccessRequestCard({
  user,
  branches,
  saving,
  onReview,
}: {
  user: AccessUser;
  branches: Branch[];
  saving: boolean;
  onReview: (
    id: string,
    decision: "approved" | "rejected",
    branchId?: string,
    role?: string,
    permissions?: string[],
  ) => void;
}) {
  const [branchId, setBranchId] = useState(
    branches[0]?.id ?? "restaurace-cerna-perla",
  );
  const [role, setRole] = useState("branch_manager");
  const [permissions, setPermissions] = useState<string[]>([
    "attendance",
    "tasks",
    "communication",
    "recipes",
    "menus",
    "ai",
  ]);

  function togglePermission(permission: string) {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    );
  }

  return (
    <article className="access-request">
      <header>
        <i>{initials(user.fullName)}</i>
        <div>
          <strong>{user.fullName}</strong>
          <small>
            {user.email} · {providerName(user.authProvider)}
          </small>
        </div>
        <span className="status">Čeká na schválení</span>
      </header>
      <div className="approval-grid">
        <label>
          <span>Pobočka</span>
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
            <option value="company">Foodtab s.r.o. · Celá firma</option>
          </select>
        </label>
        <label>
          <span>Pracovní role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {accessRoles.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="permission-picker">
        <span>Povolené moduly</span>
        <div>
          {accessModules.map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={permissions.includes(value)}
                onChange={() => togglePermission(value)}
              />
              <i>✓</i>
              {label}
            </label>
          ))}
        </div>
      </div>
      <footer>
        <button
          className="secondary"
          disabled={saving}
          onClick={() => onReview(user.id, "rejected")}
        >
          Zamítnout
        </button>
        <button
          className="primary"
          disabled={saving || permissions.length === 0}
          onClick={() =>
            onReview(user.id, "approved", branchId, role, permissions)
          }
        >
          Schválit a povolit přístup
        </button>
      </footer>
    </article>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function providerName(provider: AccessUser["authProvider"]) {
  return provider === "google"
    ? "Google"
    : provider === "apple"
      ? "Apple"
      : "E-mailový odkaz";
}
function roleName(role: string | null) {
  return accessRoles.find(([value]) => value === role)?.[1] ?? "Bez role";
}
function branchName(branchId: string | null, branches: Branch[]) {
  return branchId === "company"
    ? "Celá firma"
    : (branches.find((branch) => branch.id === branchId)?.name ??
        "Bez pobočky");
}

function InstallCenter() {
  const [installed] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        Boolean(
          (navigator as Navigator & { standalone?: boolean }).standalone,
        )),
  );
  const [notifications, setNotifications] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );

  function install() {
    window.dispatchEvent(new Event("foodtab-install"));
  }

  async function requestNotifications() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifications(result);
  }

  return (
    <>
      <Intro
        eyebrow="FOODTAB DO KAPSY"
        title="Mobilní aplikace"
        description="Nainstalujte si bezpečný přístup ke směnám, úkolům, zprávám a receptům přímo na plochu telefonu."
        action={
          <button className="primary" onClick={install}>
            {installed ? "✓ Aplikace je nainstalovaná" : "Nainstalovat Foodtab"}
          </button>
        }
      />
      <section className="install-hero card">
        <div>
          <span className="install-app-icon large">F</span>
          <small>FOODTAB PRO ZAMĚSTNANCE</small>
          <h2>Jedna aplikace pro počítač, tablet i telefon</h2>
          <p>
            Na počítači zůstává plný firemní dashboard. Na mobilu se rozhraní
            automaticky přizpůsobí rychlé práci během směny.
          </p>
          <div className="install-badges">
            <span>✓ Soukromé přihlášení</span>
            <span>✓ Data na serveru</span>
            <span>✓ Android a iPhone</span>
          </div>
        </div>
        <div className="phone-preview">
          <span className="phone-speaker" />
          <div className="phone-brand">
            <b>F</b> foodtab
          </div>
          <small>DNEŠNÍ SMĚNA</small>
          <strong>14:00–22:00</strong>
          <button>✓ Zaznamenat příchod</button>
          <small>MOJE ÚKOLY</small>
          <p>
            Kontrola teplot lednic <b>do 10:00</b>
          </p>
          <p>
            Briefing směny <b>16:15</b>
          </p>
        </div>
      </section>
      <section className="install-grid">
        <article className="card install-step">
          <span>1</span>
          <small>OTEVŘÍT</small>
          <h3>Bezpečný odkaz</h3>
          <p>
            Zaměstnanec otevře Foodtab z pozvánky nebo QR kódu a přihlásí se
            vlastním účtem.
          </p>
        </article>
        <article className="card install-step">
          <span>2</span>
          <small>NAINSTALOVAT</small>
          <h3>Přidat na plochu</h3>
          <p>
            Na Androidu použije nabídku Instalovat. Na iPhonu zvolí v Safari
            Sdílet → Přidat na plochu.
          </p>
        </article>
        <article className="card install-step">
          <span>3</span>
          <small>POUŽÍVAT</small>
          <h3>Jen potřebné moduly</h3>
          <p>
            Pracovní role určí pobočku a funkce. Vedení si ponechá kompletní
            dashboard.
          </p>
        </article>
      </section>
      <section className="card device-settings">
        <CardHead eyebrow="ZAŘÍZENÍ" title="Připravenost tohoto telefonu" />
        <div>
          <span>
            <i className={installed ? "safe-check" : ""}>
              {installed ? "✓" : "1"}
            </i>
            <b>
              Instalace na ploše
              <small>
                {installed
                  ? "Foodtab běží jako samostatná aplikace"
                  : "Nainstalujte aplikaci jedním tlačítkem"}
              </small>
            </b>
          </span>
          <button className="outline" onClick={install}>
            {installed ? "Nainstalováno" : "Nainstalovat"}
          </button>
        </div>
        <div>
          <span>
            <i className={notifications === "granted" ? "safe-check" : ""}>
              {notifications === "granted" ? "✓" : "2"}
            </i>
            <b>
              Oznámení
              <small>
                Upozornění na úkoly a zprávy připravíme v další etapě
              </small>
            </b>
          </span>
          <button
            className="outline"
            disabled={notifications === "unsupported"}
            onClick={requestNotifications}
          >
            {notifications === "granted"
              ? "Povoleno"
              : notifications === "denied"
                ? "Zakázáno v telefonu"
                : notifications === "unsupported"
                  ? "Nepodporováno"
                  : "Povolit"}
          </button>
        </div>
        <footer>
          Citlivé provozní záznamy se z bezpečnostních důvodů neukládají do
          veřejné offline mezipaměti telefonu.
        </footer>
      </section>
    </>
  );
}

function Settings() {
  const items = [
    [
      "FI",
      "Údaje firmy",
      "Foodtab s.r.o., kontakty, fakturační a bankovní údaje",
    ],
    ["PR", "Provozovny", "Restaurace Černá Perla a Bernard Bar Tábor"],
    ["LI", "Lidé a role", "Majitel, provozní, vedoucí, kuchyně, servis a bar"],
    ["OP", "Oprávnění", "Přístupy k financím, docházce, dokumentům a AI"],
    [
      "DO",
      "Firemní dokumenty",
      "Smlouvy, směrnice, formuláře a provozní manuály",
    ],
    ["AI", "Zdroje pro Gastro AI", "42 dokumentů · aktualizováno dnes"],
    ["NO", "Notifikace", "Oznámení, změny směn, úkoly a schvalování"],
    ["IN", "Integrace", "Pokladna, účetnictví a podklady pro mzdy"],
  ];
  return (
    <>
      <Intro
        eyebrow="FOODTAB S.R.O. · SPRÁVA"
        title="Nastavení firmy"
        description="Centrální konfigurace firmy, poboček, oprávnění a používaných služeb."
      />
      <section className="settings">
        {items.map((item) => (
          <button className="card" key={item[1]}>
            <span>{item[0]}</span>
            <div>
              <strong>{item[1]}</strong>
              <small>{item[2]}</small>
            </div>
            <b>→</b>
          </button>
        ))}
      </section>
    </>
  );
}
