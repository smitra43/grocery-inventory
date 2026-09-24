import type { Category, Location, Unit } from './types';

/**
 * Turns OCR'd receipt text into grocery line items with plain rules, no AI.
 * Tuned on Kroger-style receipts: "NAME  PRICE FLAG", weight lines under the
 * item, and "SC KROGER SAVINGS 1.00-" discount lines.
 */

export interface Alias {
  /** normalizeKey(receipt text) */
  key: string;
  name: string;
  category: Category;
  location: Location;
}

export interface ParsedItem {
  receiptText: string;
  name: string;
  category: Category;
  location: Location;
  quantity: number;
  unit: Unit;
  price: number;
  isFood: boolean;
  /** true when the name came from a correction the user saved before. */
  known: boolean;
}

export interface ParsedReceipt {
  date: string;
  total: number;
  items: ParsedItem[];
}

/** Key used to remember corrections: letters only, so OCR noise in digits doesn't matter. */
export function normalizeKey(text: string): string {
  return text.toUpperCase().replace(/[^A-Z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- Abbreviations -------------------------------------------------------

const PHRASES: Array<[RegExp, string]> = [
  [/\bPPR\s*TWLS?\b/g, 'PAPER TOWELS'],
  [/\bTOIL(ET)?\s*PPR\b/g, 'TOILET PAPER'],
  [/\bPNT\s*BTR\b/g, 'PEANUT BUTTER'],
  [/\bOJ\b/g, 'ORANGE JUICE'],
  [/\bWW\b/g, 'WHOLE WHEAT'],
  [/\bSR\s*CRM\b/g, 'SOUR CREAM'],
  [/\bCRM\s*CHS\b/g, 'CREAM CHEESE'],
];

const WORDS: Record<string, string> = {
  // store-brand prefixes carry no meaning for the pantry
  KRO: '', KROGER: '', KRGR: '', PS: '', PVT: '', SEL: '', HT: '', SMPL: '', TRTH: '',
  CT: '', PK: '', OZ: '', EA: '', LB: '', WT: '', SIG: '', QTY: '', GAL: 'gallon', HG: 'half gallon',
  BNLS: 'boneless', SKNLS: 'skinless', SKLS: 'skinless', CHKN: 'chicken', CHK: 'chicken', CKN: 'chicken',
  BRST: 'breast', BRS: 'breast', THGH: 'thigh', THGHS: 'thighs', DRMSTK: 'drumsticks', WNGS: 'wings',
  GRND: 'ground', GRD: 'ground', BF: 'beef', TKY: 'turkey', TRKY: 'turkey', PRK: 'pork', CHP: 'chop',
  CHPS: 'chops', BCN: 'bacon', SSG: 'sausage', SAUS: 'sausage', STK: 'steak', SLMN: 'salmon',
  SHRMP: 'shrimp', TLPIA: 'tilapia', FLT: 'fillet', FLTS: 'fillets',
  MLK: 'milk', WHL: 'whole', SKM: 'skim', YGRT: 'yogurt', YGT: 'yogurt', YOG: 'yogurt', YOGRT: 'yogurt',
  GRK: 'greek', CHS: 'cheese', CHDR: 'cheddar', CHED: 'cheddar', MOZZ: 'mozzarella', MOZ: 'mozzarella',
  PARM: 'parmesan', SHRD: 'shredded', SHRED: 'shredded', BTR: 'butter', BUTR: 'butter', CRM: 'cream',
  LG: 'large', XL: 'extra large', DZ: 'dozen', DOZ: 'dozen',
  BRD: 'bread', WHT: 'wheat', TORT: 'tortillas', TRTLA: 'tortillas', BGL: 'bagels', BGLS: 'bagels',
  ORG: 'organic', ORGNC: 'organic', FRZN: 'frozen', FRZ: 'frozen', VEG: 'vegetables', VEGG: 'veggies',
  BNNA: 'bananas', BAN: 'bananas', APPL: 'apples', APL: 'apples', STRWBRY: 'strawberries',
  STRAWB: 'strawberries', STRWB: 'strawberries', BLUBRY: 'blueberries', BLUEB: 'blueberries',
  RSPBRY: 'raspberries', GRPS: 'grapes', AVOC: 'avocado', AVO: 'avocado', TOM: 'tomatoes', TOMS: 'tomatoes',
  TMTO: 'tomatoes', POT: 'potatoes', POTS: 'potatoes', POTAT: 'potatoes', RSST: 'russet', ONN: 'onion',
  ONIN: 'onion', YLW: 'yellow', YEL: 'yellow', RD: 'red', GRN: 'green', PPR: 'pepper', PEPR: 'pepper',
  BRCLI: 'broccoli', BROC: 'broccoli', BRCL: 'broccoli', CRWN: 'crowns', CRWNS: 'crowns', CARR: 'carrots',
  CRT: 'carrots', CRTS: 'carrots', CELRY: 'celery', CUC: 'cucumber', CUKE: 'cucumber', LTC: 'lettuce',
  LETT: 'lettuce', ROM: 'romaine', SPNCH: 'spinach', SPIN: 'spinach', BBY: 'baby', MUSH: 'mushrooms',
  MSHRM: 'mushrooms', GRLC: 'garlic', LMN: 'lemon', LEM: 'lemon', LMNS: 'lemons',
  PSTA: 'pasta', SPAG: 'spaghetti', RCE: 'rice', JSMN: 'jasmine', BN: 'beans', BNS: 'beans', BLK: 'black',
  SCE: 'sauce', MRNRA: 'marinara', PNT: 'peanut', OLV: 'olive', CRL: 'cereal', FLR: 'flour', SGR: 'sugar',
  BRTH: 'broth', STCK: 'stock',
  JC: 'juice', JCE: 'juice', H2O: 'water', WTR: 'water', SPRKL: 'sparkling', COF: 'coffee', COFE: 'coffee',
  TWL: 'towels', TWLS: 'towels', TISS: 'tissue', DET: 'detergent', LNDRY: 'laundry', TRSH: 'trash',
};

export function expandName(receiptText: string): string {
  let s = ` ${receiptText.toUpperCase()} `;
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  const words = s
    .replace(/[^A-Z0-9%\s]/g, ' ')
    .split(/\s+/)
    // drop item codes, bare counts and pack sizes like 12CT, 6RL, 16OZ
    .filter((w) => w && !/^\d+$/.test(w) && !/^\d+(CT|PK|OZ|Z|LB|LBS|RL|G|KG|ML|L|GAL|DZ|EA)$/.test(w))
    .map((w) => (w in WORDS ? WORDS[w] : w.toLowerCase()))
    .filter(Boolean);
  const name = words.join(' ').replace(/\s+/g, ' ').trim();
  return name ? name[0].toUpperCase() + name.slice(1) : receiptText.trim();
}

// --- Category / storage ---------------------------------------------------

const RULES: Array<[RegExp, Category, boolean?]> = [
  [/towel|tissue|toilet|detergent|laundry|\bsoap|\bdish(es| soap)?\b|trash|\bfoil\b|plastic wrap|napkin|shampoo|cleaner|bleach|batter(y|ies)|diaper|\bbags?\b|sponge|pantiliner|liners?\b|charge\b/, 'other', false],
  [/broth|stock|soup|peanut butter|almond butter|coconut milk|\bsauce\b|salsa|\bcan(ned)?\b/, 'pantry'],
  [/salmon|shrimp|tilapia|tuna|\bcod\b|fish|crab|scallop/, 'seafood'],
  [/chicken|beef|turkey|pork|bacon|sausage|steak|\bham\b|lamb|chop|wings|drumstick|thigh/, 'meat'],
  [/\beggs?\b/, 'eggs'],
  [/milk|cheese|cheddar|mozzarella|parmesan|yogurt|butter|cream|half and half/, 'dairy'],
  [/bread|bagel|tortilla|\bbuns?\b|muffin|croissant|roll/, 'bakery'],
  [/frozen|ice cream/, 'frozen'],
  [/juice|water|soda|coffee|\btea\b|sparkling|kombucha|beer|wine/, 'beverages'],
  [/rice|pasta|spaghetti|beans|flour|sugar|cereal|oats|\boil\b|vinegar|honey|salt|spice|crackers|chips|granola|nuts|lentil/, 'pantry'],
  [/apple|banana|berr|grape|avocado|tomato|potato|onion|pepper|broccoli|carrot|celery|cucumber|lettuce|romaine|spinach|mushroom|garlic|lemon|lime|orange|kale|squash|zucchini|cabbage|pear|peach|melon|herb|cilantro|basil|asparagus|corn|peas|greens|radish|daikon|beet|salad/, 'produce'],
];

export function classify(name: string): { category: Category; location: Location; isFood: boolean } {
  const n = name.toLowerCase();
  let category: Category = 'other';
  let isFood = true;
  for (const [re, cat, food] of RULES) {
    if (re.test(n)) {
      category = cat;
      isFood = food ?? true;
      break;
    }
  }
  let location: Location = 'fridge';
  if (category === 'frozen' || /frozen/.test(n)) location = 'freezer';
  else if (['pantry', 'bakery', 'beverages'].includes(category) || !isFood) location = 'pantry';
  else if (/potato|onion|garlic|banana|avocado|tomato|squash/.test(n)) location = 'pantry';
  if (/milk|juice/.test(n) && category !== 'pantry') location = 'fridge';
  return { category, location, isFood };
}

// --- Line parsing ---------------------------------------------------------

const OCR_DIGITS: Record<string, string> = { O: '0', o: '0', D: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2' };

// Tolerates OCR slips seen on real receipts: a stray third decimal ("2.499 S" for 2.49),
// junk before the tax flag ("2.71°S"), a flag read as a symbol ("13.99 §"), trailing dots ("1.00 T.").
const PRICE_RE = /(-)?\$?\s*(\d{1,4})\s*[.,]\s*(\d{2})\d?\s*(-)?\s*[°'"`*]*\s*(?:[A-Z§®$&]{1,2}\*?|(?<=\s)[1|])?\s*[.,:;|]*\s*$/;
/** Same, for faint print where the decimal point vanished: "6 46 F". Only tried as a fallback. */
const SPACED_PRICE_RE = /(?<=\s)(-)?\$?(\d{1,3}) (\d{2})(-)?(?:\s*[A-Z§®]{1,2}\*?|\s+[1|])?\s*[.,:;|]*\s*$/;

/** Trailing price on a line, tolerating common OCR digit confusions in the last tokens. */
export function findPrice(line: string): { value: number; negative: boolean; index: number } | null {
  const attempt = (s: string) => {
    const m = PRICE_RE.exec(s) ?? SPACED_PRICE_RE.exec(s);
    if (!m) return null;
    return { value: Number(`${m[2]}.${m[3]}`), negative: Boolean(m[1] || m[4]), index: m.index };
  };
  const direct = attempt(line);
  if (direct) return direct;
  // Map look-alike letters to digits, but only in the last three tokens, and only in
  // short tokens made entirely of digits and look-alikes ("2.O9", "S", "l.5O"), never in words.
  const tokens = line.trimEnd().split(/(\s+)/);
  for (let t = tokens.length - 1, n = 0; t >= 0 && n < 3; t--) {
    if (/^\s+$/.test(tokens[t])) continue;
    n++;
    if (tokens[t].length <= 6 && /^[\dOoDIl|SsBZ.,-]+$/.test(tokens[t]) && /[\d.,]|^[SsOoBZ]$/.test(tokens[t])) {
      tokens[t] = tokens[t].replace(/[OoDIl|SsBZ]/g, (c) => OCR_DIGITS[c]);
    }
  }
  return attempt(tokens.join(''));
}

const SKIP_RE =
  /\b(SUB\s*-?\s*TOTAL|TOTAL|TAX|BALANCE|CHANGE|CASH|VISA|MASTERCARD|DEBIT|CREDIT|AMEX|DISCOVER|TEND(ER)?|PAYMENT|AUTH|APPROVED|REF(ERENCE)?|ITEMS?\s+SOLD|FUEL|POINTS|PTS|THANK|CASHIER|CUSTOMER|RECEIPT|ACCOUNT|ACCT|TERMINAL|TRANS(ACTION)?|EBT|CHIP|PLUS\s+CARD|SAVINGS\s+TOTAL|TOTAL\s+SAVINGS|YOU\s+SAVED|MEMBER|SNAP|WIC|BAL|DUE|CARD\s*#|CRV|BOTTLE\s+DEP(OSIT)?)\b/i;
/** Department headers some stores print between groups of items (Safeway: "PRODUCE", "LIQUOR"). */
const SECTION_RE =
  /^\W*(GROCERY|PRODUCE|SEAFOOD|MEAT|MEAT\/SEAFOOD|DELI|BAKERY|DAIRY|FROZEN|REFRIG\/FROZEN|REFRIGERATED|LIQUOR|WINE|BEER|GENERAL MERCHANDISE|GM|HBC|HEALTH & BEAUTY|FLORAL|PHARMACY|GROC NONEDIBLE|NONEDIBLE|MISCELLANEOUS|BULK)\W*$/i;
/** "Regular Price 20.98" (Safeway) is information; the item line already shows the price paid. */
const REGULAR_RE = /^\W*(REG\.?|R[A-Z]{4,6}R)\s+PRICE\b/i; // OCR: "Resular Price" 
/** "2 QTY TRUMER PIL 17.98" (Safeway): quantity prefix on the item line. */
const QTY_PREFIX_RE = /^\s*(\d{1,2})\s*QTY\s+/i;
/** "2 QTY" alone on a line, applying to the item below (Safeway). */
const QTY_LINE_RE = /^\W*(\d{1,2})\s*QTY\W*$/i;
const DISCOUNT_RE = /\b(SC|SAVINGS|SAVE|COUPON|CPN|DISC(OUNT)?|MFR|PROMO|DIGITAL|DIG|PRICE\s*CUT|BONUS|CARD\s+S[A-Z]{4,7})\b/i; // OCR: "Card Savinss" 
// Allows a few characters of OCR junk before the word ("x%%% BALANCE", "**** BALANCE").
const TOTAL_RE = /^\W*(?:\S{0,5}\s+)?(BALANCE(\s+DUE)?|TOTAL)\b(?!\s+(SAVINGS|TAX|ITEMS|NUMBER))/i;
/** "1.62 lb @ 3.99 /lb". Loose on purpose: faint print loses the decimal point and "@" often reads as "4" or "a". */
const WEIGHT_RE = /(\d+)\s*[.,]?\s*(\d{2})\s*(lbs?|kg|oz)\b.*?\/\s*(lbs?|kg|oz)\b/i;
const UNIT_PRICE_RE = /[@4a]\s*\$?\s*(\d+)\s*[.,]\s*(\d{2})\s*\/\s*(?:lbs?|kg|oz)\b/i;
const MULTI_RE = /^\s*(\d{1,2})\s*(?:@|FOR)\s*\$?\s*(\d+[.,]\d{2})/i;
const DATE_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/;

/** OCR often reads "lb" as "1b" or "Ib"; fix it only right after a number or a slash, where it must be a unit. */
export function fixUnits(line: string): string {
  return line.replace(/(\d\s*|\/\s*)[1Il|][bB](s?)\b/g, '$1lb$2');
}

function num(s: string): number {
  return Number(s.replace(/\s/g, '').replace(',', '.'));
}

function unitOf(u: string): Unit {
  const l = u.toLowerCase();
  return l.startsWith('lb') ? 'lb' : l === 'kg' ? 'kg' : 'oz';
}

function letters(s: string): number {
  return (s.match(/[A-Za-z]/g) ?? []).length;
}

export function parseReceipt(lines: string[], aliases: Map<string, Alias> = new Map()): ParsedReceipt {
  const items: ParsedItem[] = [];
  let date = '';
  let total = 0;
  let pendingName: string | null = null;
  /** The item created from the previous non-empty line, which a weight/qty line refers to. */
  let justAdded: ParsedItem | null = null;
  /** A "2 @ 1.25" line waiting for the item whose price is 2 × 1.25. */
  let pendingMulti: { qty: number; total: number } | null = null;
  /** A "2 QTY" line printed above its item. */
  let pendingQty: number | null = null;
  /** A weight line printed above its item (Safeway), waiting for the next item. */
  let pendingWeight: { qty: number; unit: Unit } | null = null;
  /** Last "Regular Price" seen, to recognize the informational savings line after it. */
  let regularPrice: number | null = null;
  /** Everything after the total/balance line is payment and loyalty info. */
  let ended = false;
  const matchesMulti = (item: ParsedItem | null, m: { total: number }) => item && Math.abs(item.price - m.total) < 0.02;

  const add = (text: string, price: number): ParsedItem | null => {
    const receiptText = text.replace(/\s+/g, ' ').trim();
    if (letters(receiptText) < 2 || SKIP_RE.test(receiptText)) return null;
    const alias = aliases.get(normalizeKey(receiptText));
    const name = alias?.name ?? expandName(receiptText);
    const cls = classify(name);
    const item: ParsedItem = {
      receiptText,
      name,
      category: alias?.category ?? cls.category,
      location: alias?.location ?? cls.location,
      quantity: 1,
      unit: 'count',
      price: Math.round(price * 100) / 100,
      isFood: cls.isFood,
      known: Boolean(alias),
    };
    items.push(item);
    return item;
  };

  for (const raw of lines) {
    const line = fixUnits(raw.replace(/\s+/g, ' ').trim());
    if (!line) continue;

    if (!date) {
      const d = DATE_RE.exec(line);
      if (d) {
        const [m, day] = [Number(d[1]), Number(d[2])];
        const y = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
        if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
          date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }

    if (ended) continue;
    const price = findPrice(line);
    const addedBefore = justAdded;
    justAdded = null;

    if (TOTAL_RE.test(line)) {
      if (price && !/SUB/i.test(line)) {
        total = price.value;
        ended = true;
      }
      pendingName = null;
      continue;
    }

    if (SECTION_RE.test(line.replace(/^[^A-Za-z]+/, ''))) {
      pendingName = null;
      continue;
    }

    const qtyLine = QTY_LINE_RE.exec(line);
    if (qtyLine) {
      pendingQty = Number(qtyLine[1]);
      continue;
    }

    if (REGULAR_RE.test(line)) {
      regularPrice = price?.value ?? null;
      continue;
    }

    const weight = WEIGHT_RE.exec(line);
    if (weight) {
      const qty = Number(`${weight[1]}.${weight[2]}`);
      const unit = unitOf(weight[3]);
      const unitPrice = UNIT_PRICE_RE.exec(line);
      // Weight line with its own total after "/lb": the name was on the line above.
      const hasOwnTotal = price && price.index >= weight.index + weight[0].length - 1;
      const each = unitPrice ? Number(`${unitPrice[1]}.${unitPrice[2]}`) : 0;
      const expected = Math.round(qty * each * 100) / 100;
      let target: ParsedItem | null = null;
      if (pendingName && hasOwnTotal) target = add(pendingName, price.value);
      else if (pendingName) target = add(pendingName, expected);
      // Kroger prints the weight under its item; Safeway prints it above. Attach to the item
      // just added only if its price fits the weight, otherwise hold it for the next item.
      else if (addedBefore && (!each || Math.abs(addedBefore.price - expected) < 0.03)) target = addedBefore;
      if (target) {
        target.quantity = qty;
        target.unit = unit;
      } else {
        pendingWeight = { qty, unit };
      }
      pendingName = null;
      continue;
    }

    const multi = MULTI_RE.exec(line);
    if (multi) {
      const m = { qty: Number(multi[1]), total: Math.round(Number(multi[1]) * num(multi[2]) * 100) / 100 };
      const rest = line.slice(multi[0].length, price ? price.index : undefined);
      if (letters(rest) >= 2 && price) {
        // "2 @ 1.25 KRO FRZN PEAS 2.50" all on one line
        const item = add(rest, price.value);
        if (item) item.quantity = m.qty;
      } else if (addedBefore && matchesMulti(addedBefore, m)) {
        addedBefore.quantity = m.qty;
      } else {
        pendingMulti = m; // printed above its item
      }
      pendingName = null;
      continue;
    }

    if (price && (price.negative || DISCOUNT_RE.test(line))) {
      const last = items[items.length - 1];
      // 15¢ slack: an OCR misread in any of the three numbers shouldn't turn information into a second discount.
      const alreadyApplied = regularPrice !== null && last && Math.abs(regularPrice - price.value - last.price) <= 0.15;
      if (last && !alreadyApplied) last.price = Math.max(0, Math.round((last.price - price.value) * 100) / 100);
      regularPrice = null;
      continue;
    }

    if (SKIP_RE.test(line)) {
      pendingName = null;
      continue;
    }

    if (price) {
      let namePart = line.slice(0, price.index);
      const qtyPrefix = QTY_PREFIX_RE.exec(namePart);
      if (qtyPrefix) namePart = namePart.slice(qtyPrefix[0].length);
      if (letters(namePart) >= 2) justAdded = add(namePart, price.value);
      else if (pendingName) justAdded = add(pendingName, price.value);
      if (justAdded && (qtyPrefix || pendingQty)) justAdded.quantity = Number(qtyPrefix?.[1] ?? pendingQty);
      pendingQty = null;
      if (justAdded && pendingWeight) {
        justAdded.quantity = pendingWeight.qty;
        justAdded.unit = pendingWeight.unit;
      }
      pendingWeight = null;
      regularPrice = null;
      if (pendingMulti && justAdded && matchesMulti(justAdded, pendingMulti)) justAdded.quantity = pendingMulti.qty;
      pendingMulti = null;
      pendingName = null;
    } else if (letters(line) >= 3) {
      pendingName = line;
    }
  }

  return { date, total, items };
}
