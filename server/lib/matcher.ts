/**
 * Matches Hardcover books to Audiobookshelf items. Pure: give it the books,
 * the library and the ID links, get back a decision per book.
 *
 * No single signal decides a match. ASINs and ISBNs in a library are often
 * wrong, so an ID hit only counts when the title and author agree with it, and
 * a title/author hit with no ID needs to be very close. Anything in between
 * goes to review instead of being guessed.
 */
import type { Strictness } from "./settings.js";
import {
  authorSimilarity,
  dice,
  indexTokens,
  cleanTitle,
  seriesNumber,
  titleSimilarity,
  titleVariants,
} from "./normalize.js";

export interface HcBook {
  id: number;
  title: string;
  subtitle?: string | null;
  authors: string[];
  seriesName?: string | null;
  seriesPosition?: number | null;
  audioSeconds?: number | null;
}

export interface AbsItem {
  id: string;
  title: string;
  subtitle?: string | null;
  authors: string[];
  series: { name: string; sequence: number | null }[];
  asin?: string | null;
  isbn?: string | null;
  duration?: number | null;
}

export type Status = "matched" | "review" | "missing";

export interface Candidate {
  absItemId: string;
  score: number;
  titleSim: number;
  authorSim: number | null;
  idVia: string[];
  notes: string[];
}

export interface MatchResult {
  hcBookId: number;
  status: Status;
  absItemId: string | null;
  score: number;
  reasons: string[];
  candidates: Candidate[];
}

const THRESHOLDS: Record<Strictness, { title: number; author: number; idTitle: number; idAuthor: number; review: number }> = {
  strict: { title: 0.95, author: 0.9, idTitle: 0.7, idAuthor: 0.7, review: 45 },
  balanced: { title: 0.9, author: 0.85, idTitle: 0.6, idAuthor: 0.6, review: 50 },
  loose: { title: 0.85, author: 0.75, idTitle: 0.5, idAuthor: 0.5, review: 55 },
};

/** Fast lookup of library items by title words. Build once per library. */
export class LibraryIndex {
  readonly byId = new Map<string, AbsItem & { variants: string[] }>();
  private readonly byToken = new Map<string, Set<string>>();
  private readonly byExact = new Map<string, Set<string>>();

  constructor(items: AbsItem[]) {
    for (const item of items) {
      const variants = titleVariants(item.title, item.subtitle);
      this.byId.set(item.id, { ...item, variants });
      for (const v of variants) {
        if (!this.byExact.has(v)) this.byExact.set(v, new Set());
        this.byExact.get(v)!.add(item.id);
      }
      for (const t of indexTokens(`${item.title} ${item.subtitle ?? ""}`)) {
        if (!this.byToken.has(t)) this.byToken.set(t, new Set());
        this.byToken.get(t)!.add(item.id);
      }
    }
  }

  /** Items sharing an exact title variant or enough title words with this book. */
  textCandidates(book: HcBook, limit = 40): string[] {
    const hits = new Map<string, number>();
    for (const v of titleVariants(book.title, book.subtitle)) {
      for (const id of this.byExact.get(v) ?? []) hits.set(id, (hits.get(id) ?? 0) + 100);
    }
    const tokens = indexTokens(`${book.title} ${book.subtitle ?? ""}`);
    for (const t of tokens) {
      const ids = this.byToken.get(t);
      // Very common words ("dark", "king") point at too much to be useful alone.
      if (!ids || ids.size > 400) continue;
      for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    const need = tokens.length >= 3 ? 2 : 1;
    return [...hits.entries()]
      .filter(([, n]) => n >= need)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  }
}

export function scoreCandidate(
  book: HcBook,
  item: AbsItem & { variants?: string[] },
  idVia: string[],
): Candidate {
  const notes: string[] = [];
  const bookVariants = titleVariants(book.title, book.subtitle);
  const itemVariants = item.variants ?? titleVariants(item.title, item.subtitle);
  const titleSim = titleSimilarity(bookVariants, itemVariants);
  const authorSim = authorSimilarity(book.authors, item.authors);

  let score = 45 * titleSim + 30 * (authorSim ?? 0.6);
  if (idVia.length) {
    score += 25;
    notes.push(`${idVia.map(viaLabel).join(" and ")} points to this book`);
  }
  if (authorSim === null) notes.push("no author to compare");

  // Same series but a different number is almost always the wrong book.
  if (book.seriesName && book.seriesPosition != null && item.series.length) {
    const target = cleanTitle(book.seriesName);
    for (const s of item.series) {
      if (dice(cleanTitle(s.name), target) < 0.8) continue;
      const seq = seriesNumber(s.sequence);
      if (seq == null) break;
      if (seq === book.seriesPosition) {
        score += 5;
        notes.push(`same series position (#${seq})`);
      } else {
        score -= 25;
        notes.push(`series number differs (#${seq} vs #${book.seriesPosition})`);
      }
      break;
    }
  }

  if (book.audioSeconds && item.duration) {
    const ratio = item.duration / book.audioSeconds;
    if (ratio > 0.85 && ratio < 1.15) {
      score += 3;
      notes.push("length matches");
    }
  }

  return {
    absItemId: item.id,
    score: Math.max(0, Math.min(100, Math.round(score))),
    titleSim: round(titleSim),
    authorSim: authorSim === null ? null : round(authorSim),
    idVia,
    notes,
  };
}

export function matchBook(
  book: HcBook,
  index: LibraryIndex,
  idLinks: Map<number, Map<string, string[]>>,
  strictness: Strictness = "balanced",
): MatchResult {
  const t = THRESHOLDS[strictness];
  const linked = idLinks.get(book.id) ?? new Map<string, string[]>();
  const ids = new Set<string>([...linked.keys(), ...index.textCandidates(book)]);

  const candidates: Candidate[] = [];
  for (const id of ids) {
    const item = index.byId.get(id);
    if (!item) continue;
    candidates.push(scoreCandidate(book, item, linked.get(id) ?? []));
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5);
  const best = top[0];

  if (!best) {
    return { hcBookId: book.id, status: "missing", absItemId: null, score: 0, reasons: ["nothing similar in the library"], candidates: [] };
  }

  const { status, reasons } = judge(top, strictness, "in the library");
  return {
    hcBookId: book.id,
    status,
    absItemId: status === "missing" ? null : best.absItemId,
    score: best.score,
    reasons,
    candidates: top,
  };
}

/**
 * Decides how sure a ranked candidate list is. Shared by both directions:
 * Hardcover book to library item (collections) and library item to
 * Hardcover book (reading progress).
 */
export function judge(
  top: Pick<Candidate, "score" | "titleSim" | "authorSim" | "idVia" | "notes">[],
  strictness: Strictness = "balanced",
  where = "in the library",
): { status: Status; reasons: string[] } {
  const t = THRESHOLDS[strictness];
  const best = top[0];
  if (!best) return { status: "missing", reasons: [`nothing similar ${where}`] };
  const seriesConflict = best.notes.some((n) => n.startsWith("series number differs"));
  const authorOk = (min: number) => best.authorSim === null || best.authorSim >= min;
  const reasons: string[] = [];
  let status: Status;

  if (best.idVia.length && best.titleSim >= t.idTitle && authorOk(t.idAuthor) && !seriesConflict) {
    status = "matched";
    reasons.push("ID match confirmed by title and author");
  } else if (best.titleSim >= t.title && best.authorSim !== null && best.authorSim >= t.author && !seriesConflict) {
    status = "matched";
    reasons.push("title and author match");
  } else if (best.idVia.length) {
    status = "review";
    reasons.push("the ASIN/ISBN points here, but the title or author disagrees; the ID may be wrong");
  } else if (best.score >= t.review) {
    status = "review";
    reasons.push("close, but not certain");
  } else {
    status = "missing";
    reasons.push(`no confident match ${where}`);
  }

  // Two different candidates both look right: say so.
  const runnerUp = top[1];
  if (status === "matched" && runnerUp && runnerUp.score >= best.score - 2 && runnerUp.titleSim >= t.title && !runnerUp.idVia.length && !best.idVia.length) {
    reasons.push("another candidate looks just as good; picked the closest");
  }
  return { status, reasons: [...reasons, ...best.notes] };
}

function viaLabel(v: string): string {
  return v === "isbn" ? "ISBN" : v === "asin" ? "ASIN" : v === "audible" ? "Audible ID" : v === "amazon" ? "Amazon ID" : v;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
