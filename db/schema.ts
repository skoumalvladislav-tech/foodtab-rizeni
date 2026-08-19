import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const operationTasks = sqliteTable("operation_tasks", {
  id: integer("id").primaryKey(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const attendanceEvents = sqliteTable("attendance_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeEmail: text("employee_email").notNull(),
  action: text("action", { enum: ["in", "out"] }).notNull(),
  location: text("location").notNull(),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email").notNull(),
  role: text("role").notNull().default("Vedení"),
  text: text("text").notNull(),
  location: text("location").notNull(),
  audienceType: text("audience_type", { enum: ["company", "branch", "person"] }).notNull().default("company"),
  targetBranchId: text("target_branch_id"),
  targetPersonEmail: text("target_person_email"),
  targetPersonName: text("target_person_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assignedTasks = sqliteTable("assigned_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  note: text("note").notNull().default(""),
  createdByEmail: text("created_by_email").notNull(),
  createdByName: text("created_by_name").notNull(),
  originLocation: text("origin_location").notNull(),
  audienceType: text("audience_type", { enum: ["company", "branch", "person"] }).notNull().default("company"),
  targetBranchId: text("target_branch_id"),
  targetPersonEmail: text("target_person_email"),
  targetPersonName: text("target_person_name"),
  dueAt: text("due_at").notNull(),
  priority: text("priority", { enum: ["normal", "high"] }).notNull().default("normal"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recipes = sqliteTable("recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: text("branch_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  portions: integer("portions").notNull().default(1),
  allergens: text("allergens").notNull().default(""),
  ingredients: text("ingredients").notNull(),
  instructions: text("instructions").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const menuItems = sqliteTable("menu_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: text("branch_id").notNull(),
  menuType: text("menu_type", { enum: ["permanent", "weekly"] }).notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  price: integer("price").notNull(),
  allergens: text("allergens").notNull().default(""),
  dayLabel: text("day_label").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const weeklyMenuDocuments = sqliteTable("weekly_menu_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  branchId: text("branch_id").notNull(),
  weekLabel: text("week_label").notNull(),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(),
  fileSize: integer("file_size").notNull(),
  source: text("source", { enum: ["dashboard", "ai_agent"] }).notNull().default("dashboard"),
  status: text("status", { enum: ["ready", "processing", "failed"] }).notNull().default("ready"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: text("uploaded_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shifts = sqliteTable(
  "shifts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    branchId: text("branch_id").notNull(),
    department: text("department", { enum: ["bar", "kuchyne"] }).notNull(),
    shiftDate: text("shift_date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    employeeUserId: text("employee_user_id"),
    employeeName: text("employee_name").notNull(),
    employeeEmail: text("employee_email").notNull(),
    isPlaceholder: integer("is_placeholder", { mode: "boolean" })
      .notNull()
      .default(true),
    note: text("note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_shifts_branch_date").on(table.branchId, table.shiftDate),
    index("idx_shifts_employee_email").on(table.employeeEmail),
  ],
);

export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  authProvider: text("auth_provider", { enum: ["email", "google", "apple"] }).notNull().default("email"),
  status: text("status", { enum: ["pending", "approved", "rejected", "suspended"] }).notNull().default("pending"),
  branchId: text("branch_id"),
  role: text("role"),
  permissionsJson: text("permissions_json").notNull().default("[]"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by"),
});
