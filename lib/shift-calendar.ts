export type GridDay = {
  date: string;
  day: number;
  inMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
};

export type ShiftRow = {
  id: number;
  branchId: string;
  department: "bar" | "kuchyne";
  shiftDate: string;
  startTime: string;
  endTime: string;
  employeeUserId: string | null;
  employeeName: string;
  employeeEmail: string;
  isPlaceholder: boolean;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RosterMember = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
};

export function getMonthGrid(year: number, month: number): GridDay[] {
  const todayStr = toDateStr(new Date());
  const firstDay = new Date(year, month - 1, 1);
  // Monday-first: 0=Mon … 6=Sun; JS: 0=Sun … 6=Sat
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const grid: GridDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, month - 1, 1 - startOffset + i);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    const dateStr = toDateStr(d);
    grid.push({
      date: dateStr,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      isWeekend: dow === 0 || dow === 6,
      isToday: dateStr === todayStr,
    });
  }
  return grid;
}

export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function groupByDate(rows: ShiftRow[]): Record<string, ShiftRow[]> {
  const map: Record<string, ShiftRow[]> = {};
  for (const row of rows) {
    (map[row.shiftDate] ??= []).push(row);
  }
  return map;
}

export function nextMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

export function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function monthEnd(year: number, month: number): string {
  const [ny, nm] = nextMonth(year, month);
  return monthStart(ny, nm);
}
