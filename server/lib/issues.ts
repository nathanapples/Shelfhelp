/**
 * Issues: anyone can report a problem with a book and comment on any issue.
 * Admins resolve, reopen and delete them.
 */
import { db, json } from "./db.js";
import { hardcoverBook, inLibrary } from "./requests.js";
import { log } from "./activity.js";

export const ISSUE_KINDS: Record<string, string> = {
  audio: "Audio problem",
  missing: "Missing or out-of-order chapters",
  wrong: "Wrong book or edition",
  metadata: "Wrong details or cover",
  other: "Something else",
};

export type IssueStatus = "open" | "resolved";

interface IssueRow {
  id: number;
  hc_book_id: number;
  abs_item_id: string | null;
  title: string;
  authors: string | null;
  slug: string | null;
  cover_url: string | null;
  kind: string;
  status: IssueStatus;
  created_by: number;
  created_at: string;
  updated_at: string;
  resolved_by: number | null;
  resolved_at: string | null;
}

const name = (id: number | null) =>
  id === null
    ? null
    : ((db.prepare("SELECT COALESCE(display_name, username, email, 'Someone') AS n FROM users WHERE id = ?").get(id) as { n: string } | undefined)?.n ??
      "Someone");

function issueView(r: IssueRow) {
  const stats = db.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM issue_comments WHERE issue_id = ? AND event IS NULL").get(r.id) as {
    n: number;
    last: string | null;
  };
  const first = db.prepare("SELECT body FROM issue_comments WHERE issue_id = ? AND event IS NULL ORDER BY id LIMIT 1").get(r.id) as { body: string } | undefined;
  return {
    id: r.id,
    hcBookId: r.hc_book_id,
    absItemId: r.abs_item_id,
    title: r.title,
    authors: json<string[]>(r.authors, []),
    slug: r.slug,
    hcUrl: r.slug ? `https://hardcover.app/books/${r.slug}` : null,
    coverUrl: r.cover_url,
    kind: r.kind,
    kindLabel: ISSUE_KINDS[r.kind] ?? r.kind,
    status: r.status,
    createdBy: name(r.created_by),
    createdById: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedBy: name(r.resolved_by),
    resolvedAt: r.resolved_at,
    comments: stats.n,
    lastCommentAt: stats.last,
    summary: first?.body ?? "",
  };
}

function get(id: number): IssueRow {
  const r = db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as unknown as IssueRow | undefined;
  if (!r) throw new Error("That issue is gone.");
  return r;
}

export function listIssues(status: "open" | "resolved" | "all" = "open", hcBookId?: number) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  if (hcBookId) {
    where.push("hc_book_id = ?");
    args.push(hcBookId);
  }
  const rows = db
    .prepare(`SELECT * FROM issues ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`)
    .all(...args) as unknown as IssueRow[];
  return rows.map(issueView);
}

export function issueCounts() {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM issues GROUP BY status").all() as { status: IssueStatus; n: number }[];
  return { open: rows.find((r) => r.status === "open")?.n ?? 0, resolved: rows.find((r) => r.status === "resolved")?.n ?? 0 };
}

export function issueDetail(id: number) {
  const r = get(id);
  const comments = db.prepare("SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY id").all(id) as {
    id: number;
    user_id: number;
    body: string;
    event: string | null;
    created_at: string;
  }[];
  const roles = new Map(
    (db.prepare("SELECT id, role FROM users").all() as { id: number; role: string }[]).map((u) => [u.id, u.role]),
  );
  return {
    ...issueView(r),
    thread: comments.map((c) => ({
      id: c.id,
      userId: c.user_id,
      author: name(c.user_id),
      admin: roles.get(c.user_id) === "admin",
      body: c.body,
      event: c.event,
      createdAt: c.created_at,
    })),
  };
}

const clean = (body: string) => String(body ?? "").trim().slice(0, 5000);

export async function createIssue(userId: number, hcBookId: number, kind: string, body: string) {
  if (!(kind in ISSUE_KINDS)) kind = "other";
  const text = clean(body);
  if (!text) throw new Error("Say what's wrong.");
  const book = await hardcoverBook({ id: hcBookId });
  if (!book) throw new Error("Hardcover has no such book.");
  const r = db
    .prepare(
      `INSERT INTO issues (hc_book_id, abs_item_id, title, authors, slug, cover_url, kind, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(book.id, inLibrary([book.id]).get(book.id) ?? null, book.title, JSON.stringify(book.authors), book.slug, book.coverUrl, kind, userId);
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO issue_comments (issue_id, user_id, body) VALUES (?, ?, ?)").run(id, userId, text);
  log("info", `${name(userId)} reported an issue with "${book.title}": ${ISSUE_KINDS[kind]}`);
  return issueDetail(id);
}

export function addComment(id: number, userId: number, body: string) {
  get(id);
  const text = clean(body);
  if (!text) throw new Error("Write something first.");
  db.prepare("INSERT INTO issue_comments (issue_id, user_id, body) VALUES (?, ?, ?)").run(id, userId, text);
  db.prepare("UPDATE issues SET updated_at = datetime('now') WHERE id = ?").run(id);
  return issueDetail(id);
}

/** Admins only (checked by the route). */
export function setIssueStatus(id: number, userId: number, status: IssueStatus) {
  const r = get(id);
  if (r.status === status) return issueDetail(id);
  if (status === "resolved") {
    db.prepare("UPDATE issues SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(userId, id);
  } else {
    db.prepare("UPDATE issues SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
  }
  db.prepare("INSERT INTO issue_comments (issue_id, user_id, body, event) VALUES (?, ?, '', ?)").run(id, userId, status === "resolved" ? "resolved" : "reopened");
  log("info", `${name(userId)} ${status === "resolved" ? "resolved" : "reopened"} the issue with "${r.title}"`);
  return issueDetail(id);
}

export function deleteIssue(id: number) {
  db.prepare("DELETE FROM issue_comments WHERE issue_id = ?").run(id);
  db.prepare("DELETE FROM issues WHERE id = ?").run(id);
}
