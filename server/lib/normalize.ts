/** Text cleanup and similarity used by the matcher. Pure functions, no I/O. */

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
};

const NOISE = [
  /\bunabridged\b/g,
  /\babridged\b/g,
  /\bdramati[sz]ed( adaptation)?\b/g,
  /\bfull[- ]cast( edition| recording)?\b/g,
  /\bgraphic ?audio\b/g,
  /\baudio ?book\b/g,
  /\ban? (novel|memoir|thriller|novella)\b/g,
  /\b(special|anniversary|collector'?s|deluxe|expanded|revised) edition\b/g,
];

const SERIES_MARKER =
  /\b(book|volume|vol|part|bk|episode|novel|tome)\.?\s*(\d+(\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g;

export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‘’ʼ]/g, "'");
}

function squash(s: string): string {
  return s
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

/** A title with edition noise, bracketed text and series markers removed. */
export function cleanTitle(raw: string): string {
  let s = fold(raw);
  s = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(SERIES_MARKER, " ");
  s = s.replace(/#\s*\d+(\.\d+)?/g, " ");
  return squash(s);
}

/**
 * The versions of a title worth comparing: the whole thing, the part before a
 * colon or dash (main title), and the part after (which is the real title when
 * a store prefixes the series, e.g. "Mistborn: The Final Empire").
 */
export function titleVariants(title: string, subtitle?: string | null): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined | null) => {
    if (!s) return;
    const c = cleanTitle(s);
    if (c.length >= 2) out.add(c);
  };
  add(title);
  if (subtitle) add(`${title} ${subtitle}`);
  const parts = fold(title).split(/\s*[:\u2013\u2014]\s*|\s+-\s+/);
  if (parts.length > 1) {
    add(parts[0]);
    add(parts.slice(1).join(" "));
  }
  return [...out];
}

/** "Sanderson, Brandon" and "J. R. R. Tolkien" become "brandon sanderson" and "jrr tolkien". */
export function cleanAuthor(raw: string): string {
  let s = fold(raw).trim();
  const comma = s.match(/^([^,]+),\s*([^,]+)$/);
  if (comma && !/\b(jr|sr|ii|iii|phd|md)\.?$/.test(comma[2])) s = `${comma[2]} ${comma[1]}`;
  s = s.replace(/\b(jr|sr|phd|md|dr|prof)\b\.?/g, " ");
  s = s.replace(/\./g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  // Join runs of initials: "j r r tolkien" -> "jrr tolkien"
  s = s.replace(/\b([a-z])( [a-z]\b)+/g, (m) => m.replace(/ /g, ""));
  return s;
}

/** Splits an Audiobookshelf-style author string ("A, B & C") into names. */
export function splitAuthors(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\s*(?:,|&|;|\band\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice on character bigrams: 1 is identical, 0 shares nothing. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    total += n;
    const m = B.get(g);
    if (m) overlap += Math.min(n, m);
  }
  for (const n of B.values()) total += n;
  return (2 * overlap) / total;
}

export function titleSimilarity(aVariants: string[], bVariants: string[]): number {
  let best = 0;
  for (const a of aVariants) {
    for (const b of bVariants) {
      // A very short fragment (e.g. "it") shouldn't match on its own.
      if (Math.min(a.length, b.length) < 4 && a !== b) continue;
      best = Math.max(best, dice(a, b));
      if (best === 1) return 1;
    }
  }
  return best;
}

function lastName(n: string): string {
  const parts = n.split(" ");
  return parts[parts.length - 1] ?? "";
}

/** Best similarity between any author on one side and any on the other. null if either side has none. */
export function authorSimilarity(a: string[], b: string[]): number | null {
  const A = a.map(cleanAuthor).filter(Boolean);
  const B = b.map(cleanAuthor).filter(Boolean);
  if (!A.length || !B.length) return null;
  // "Weir, Andy" can arrive split into two "authors"; compare the whole string too.
  if (A.length > 1) A.push(A.join(" "));
  if (B.length > 1) B.push(B.join(" "));
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  let best = 0;
  for (const x of A) {
    for (const y of B) {
      if (x === y) return 1;
      if (sorted(x) === sorted(y)) {
        best = Math.max(best, 0.97);
        continue;
      }
      let s = dice(x, y);
      if (lastName(x) === lastName(y) && lastName(x).length > 1) {
        s = Math.max(s, x[0] === y[0] ? 0.95 : 0.8);
      }
      best = Math.max(best, s);
    }
  }
  return best;
}

export function seriesNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = fold(String(raw)).trim();
  const m = s.match(/\d+(\.\d+)?/);
  if (m) return Number(m[0]);
  return NUMBER_WORDS[s] ? Number(NUMBER_WORDS[s]) : null;
}

/** Parses ABS "Series Name #3, Other #1.5" into parts. */
export function parseAbsSeries(seriesName: string | null | undefined): { name: string; sequence: number | null }[] {
  if (!seriesName) return [];
  return seriesName
    .split(/,\s+/)
    .map((part) => {
      const m = part.match(/^(.*?)\s*#\s*([\d.]+)\s*$/);
      return m ? { name: m[1].trim(), sequence: Number(m[2]) } : { name: part.trim(), sequence: null };
    })
    .filter((s) => s.name);
}

export function normalizeIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length === 13 && /^\d{13}$/.test(s)) return s;
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) return s;
  return null;
}

export function normalizeAsin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{10}$/.test(s) ? s : null;
}

/** Words worth indexing a title by: no stopwords, no tiny tokens. */
const STOP = new Set(["the", "and", "of", "a", "an", "in", "on", "to", "for", "with", "from", "book", "novel"]);
export function indexTokens(title: string): string[] {
  return [...new Set(cleanTitle(title).split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))];
}
