import { addDays, daysBetween, toISO } from './dates';
import type { MealKit } from './types';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface ParsedKitEmail {
  deliveredOn: string;
  meals: string[];
}

/**
 * Pick the year for a "Sunday, August 9" style date with no year: the year where the
 * weekday matches (when given), closest to today. Exported for tests.
 */
export function resolveDate(month: number, day: number, weekday: number | null, today: string): string {
  const y = Number(today.slice(0, 4));
  const candidates = [y - 1, y, y + 1].map((yr) => new Date(yr, month, day));
  const matching = weekday === null ? candidates : candidates.filter((d) => d.getDay() === weekday);
  const pool = matching.length ? matching : candidates;
  pool.sort((a, b) => Math.abs(daysBetween(today, toISO(a))) - Math.abs(daysBetween(today, toISO(b))));
  return toISO(pool[0]);
}

const FOOTER = /unsubscribe|privacy|terms|copyright|©|manage|questions|help center|download|app store|google play|follow us|view in browser|all rights/i;
const NOT_A_MEAL = /\border\b|deliver|arriv|recipe card|ingredient|temperature|shipping|tracking|your box|^(hi|hello|hey)\b|thank|remember|^home chef$/i;

/**
 * Pull delivery date and meal names from a Home Chef shipping or order email pasted as text.
 * Meal names are the short title-like lines after the "Home Chef" header.
 */
export function parseHomeChefEmail(text: string, today: string): ParsedKitEmail {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  let deliveredOn = today;
  const dateRe = new RegExp(
    `(?:(${WEEKDAYS.join('|')}),?\\s+)?(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    'i',
  );
  const d = dateRe.exec(text);
  if (d) {
    const month = MONTHS.indexOf(d[2].toLowerCase());
    const day = Number(d[3]);
    deliveredOn = d[4]
      ? toISO(new Date(Number(d[4]), month, day))
      : resolveDate(month, day, d[1] ? WEEKDAYS.indexOf(d[1].toLowerCase()) : null, today);
  }

  // Meals come after the last "Home Chef" header line; fall back to the whole email.
  let start = -1;
  lines.forEach((l, i) => {
    if (/^home chef$/i.test(l)) start = i;
  });
  const meals: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (FOOTER.test(line)) break;
    const words = line.split(' ');
    const titleLike =
      words.length >= 2 &&
      words.length <= 10 &&
      line.length <= 70 &&
      !/[.!?:;]$/.test(line) &&
      !/\d{3,}/.test(line) &&
      /^[A-Z]/.test(line) &&
      !NOT_A_MEAL.test(line);
    if (titleLike && !meals.includes(line)) meals.push(line);
  }
  return { deliveredOn, meals };
}

/**
 * Cook-by estimate. Meal kits ship fresh protein; seafood keeps the shortest.
 * These are conservative guesses, shown as editable.
 */
export function estimateCookBy(name: string, deliveredOn: string): string {
  const n = name.toLowerCase();
  if (/salmon|shrimp|cod|tilapia|fish|scallop|tuna|seafood|crab/.test(n)) return addDays(deliveredOn, 2);
  if (/steak|beef|pork|chicken|turkey|sausage|lamb/.test(n)) return addDays(deliveredOn, 4);
  return addDays(deliveredOn, 5);
}

export function homeChefSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function homeChefUrl(name: string): string {
  return `https://www.homechef.com/meals/${homeChefSlug(name)}`;
}

export function kitsByUrgency(kits: MealKit[]): MealKit[] {
  return kits.filter((k) => k.status === 'active').sort((a, b) => a.cookBy.localeCompare(b.cookBy));
}
