/** Ticket-04 §3 local leaderboard rules (pure; shared by the browser, the launcher and the tests). */

export interface LeaderboardEntry {
  name: string;
  score: number; // total of the nights won
  nights_won: number; // 0..3
  achieved_at: string; // ISO 8601 with timezone offset
  seed: number;
}

export const MAX_ENTRIES = 10;
/** 3–12 chars of [A-Za-z0-9_]; Vietnamese letters with diacritics are also accepted (bonus). */
const NAME_RE = /^[\p{L}\p{M}\p{Nd}_]{3,12}$/u;

export function validName(name: string): boolean {
  return NAME_RE.test(name.normalize('NFC'));
}

/** Local time with its offset, e.g. 2026-11-20T21:05:09+07:00. */
export function isoWithOffset(d: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

export function validEntry(e: unknown): e is LeaderboardEntry {
  const x = e as LeaderboardEntry;
  return !!x && typeof x.name === 'string' && validName(x.name) && Number.isFinite(x.score) && x.score >= 0
    && Number.isInteger(x.nights_won) && x.nights_won >= 0 && x.nights_won <= 3
    && typeof x.achieved_at === 'string' && !Number.isNaN(Date.parse(x.achieved_at)) && Number.isInteger(x.seed);
}

/** Score descending; equal scores: whoever achieved it first ranks higher. Keeps the top 10. */
export function rank(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.score - a.e.score || Date.parse(a.e.achieved_at) - Date.parse(b.e.achieved_at) || a.i - b.i)
    .map((x) => x.e)
    .slice(0, MAX_ENTRIES);
}

export function addEntry(entries: LeaderboardEntry[], entry: LeaderboardEntry): LeaderboardEntry[] {
  if (!validEntry(entry)) throw new Error('invalid leaderboard entry');
  return rank([...entries, { ...entry, name: entry.name.normalize('NFC') }]);
}
