import { db } from "./db.js";

export type Level = "info" | "warn" | "error";

export function log(level: Level, message: string, listId?: number | null) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${listId ? `(list ${listId}) ` : ""}${message}`;
  (level === "error" ? console.error : console.log)(line);
  db.prepare("INSERT INTO activity (level, list_id, message) VALUES (?, ?, ?)").run(level, listId ?? null, message);
  // Keep the log from growing forever.
  db.prepare("DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 2000").run();
}

export function recentActivity(limit = 200) {
  return db
    .prepare(
      `SELECT a.id, a.ts, a.level, a.list_id AS listId, a.message, l.name AS listName
       FROM activity a LEFT JOIN lists l ON l.id = a.list_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit);
}
