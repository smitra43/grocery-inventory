/**
 * Look up a Home Chef recipe page by meal name and pull out servings, per-serving
 * macros and ingredients. Home Chef has no API; recipe pages are public at
 * https://www.homechef.com/meals/<slug>. Parsing tries schema.org Recipe JSON-LD, then
 * schema.org microdata (what Home Chef's pages use, per the page markup), then nutrition text, so a page redesign degrades to "not found"
 * (the user types macros from the recipe card) rather than wrong numbers.
 */

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Nutrition panel rows in label order, with their schema.org field and default unit. */
const PANEL = [
  ['Calories', 'calories', ''],
  ['Fat', 'fatContent', 'g'],
  ['Saturated fat', 'saturatedFatContent', 'g'],
  ['Trans fat', 'transFatContent', 'g'],
  ['Cholesterol', 'cholesterolContent', 'mg'],
  ['Sodium', 'sodiumContent', 'mg'],
  ['Carbohydrates', 'carbohydrateContent', 'g'],
  ['Fiber', 'fiberContent', 'g'],
  ['Sugar', 'sugarContent', 'g'],
  ['Protein', 'proteinContent', 'g'],
];

/** "640 kcal" → "640", "1717 mg" → "1717mg", "48" → "48g" (default unit). */
function formatValue(raw, unit) {
  const m = /(\d+(?:\.\d+)?)\s*(kcal|cal|mg|g)?/i.exec(String(raw ?? ''));
  if (!m) return null;
  const u = (m[2] ?? unit).toLowerCase();
  return `${m[1]}${u === 'kcal' || u === 'cal' ? '' : u}`;
}

const firstNumber = (v) => {
  const m = /(\d+(?:\.\d+)?)/.exec(String(v ?? ''));
  return m ? Math.round(Number(m[1])) : null;
};

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const type = node['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node;
  return findRecipe(node['@graph']);
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * schema.org microdata, the format Home Chef uses, e.g.
 * <strong class="textSm float-right" itemprop="carbohydrateContent">55g</strong>.
 * Returns { prop: [values] } from each itemprop's content attribute or its text.
 */
function readMicrodata(html) {
  const props = {};
  const add = (k, v) => {
    const val = decode(String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (val) (props[k] ??= []).push(val);
  };
  // <meta itemprop="x" content="y"> and any tag carrying a content attribute
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\bitemprop=["']([\w]+)["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/gi)) add(m[1], m[2]);
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bitemprop=["']([\w]+)["'][^>]*>/gi)) add(m[2], m[1]);
  // <tag itemprop="x">text</tag>, allowing simple inline markup inside
  for (const m of html.matchAll(/<([a-z0-9]+)\b(?![^>]*\bcontent=)[^>]*\bitemprop=["']([\w]+)["'][^>]*>([\s\S]*?)<\/\1>/gi)) add(m[2], m[3]);
  return props;
}

/**
 * If calories are missing but protein, carbs and fat were found, derive calories (4/4/9 kcal per g)
 * and mark the panel row as estimated, rather than dropping the whole lookup.
 */
function withCalories(macros, facts) {
  if (macros.calories !== null || [macros.protein, macros.carbs, macros.fat].some((v) => v === null)) return { macros, facts };
  const calories = Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fat * 9);
  return { macros: { ...macros, calories }, facts: [{ label: 'Calories (est.)', value: String(calories) }, ...facts] };
}

/** Returns { title, servings, macros|null, ingredients[], facts[] } or null if the page isn't a recipe. */
export function parseRecipePage(html) {
  // 1. schema.org JSON-LD
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of scripts) {
    let json;
    try {
      json = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const r = findRecipe(json);
    if (!r) continue;
    const n = r.nutrition ?? {};
    const { macros, facts } = withCalories(
      {
        calories: firstNumber(n.calories),
        protein: firstNumber(n.proteinContent),
        carbs: firstNumber(n.carbohydrateContent),
        fat: firstNumber(n.fatContent),
      },
      PANEL.map(([label, key, unit]) => ({ label, value: formatValue(n[key], unit) })).filter((f) => f.value),
    );
    return {
      title: decode(String(r.name ?? '')),
      servings: firstNumber(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield) ?? 2,
      macros: Object.values(macros).every((v) => v !== null) ? macros : null,
      ingredients: Array.isArray(r.recipeIngredient) ? r.recipeIngredient.map((i) => decode(String(i))) : [],
      facts,
    };
  }

  // 2. schema.org microdata (itemprop attributes in the page markup)
  const md = readMicrodata(html);
  if (md.calories || md.proteinContent || md.carbohydrateContent) {
    const first = (k) => md[k]?.[0];
    const facts = PANEL.map(([label, key, unit]) => ({ label, value: formatValue(first(key), unit) })).filter((f) => f.value);
    const { macros, facts: panel } = withCalories(
      {
        calories: firstNumber(first('calories')),
        protein: firstNumber(first('proteinContent')),
        carbs: firstNumber(first('carbohydrateContent')),
        fat: firstNumber(first('fatContent')),
      },
      facts,
    );
    const title = first('name') ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
    return {
      title: decode(title).replace(/\s*[|-]\s*Home Chef.*$/i, '').trim(),
      servings: firstNumber(first('recipeYield')) ?? 2,
      macros: Object.values(macros).every((v) => v !== null) ? macros : null,
      ingredients: md.recipeIngredient ?? md.ingredients ?? [],
      facts: panel,
    };
  }

  // 3. Visible text, e.g. "Calories 554 · Protein 44g · Carbohydrates 25g · Fat 31g"
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  // Panels are written "Sodium 1717mg" or "1717mg Sodium". Flattened text can't tell which number
  // belongs to which label row by row, so decide the layout for the whole page first: count
  // unit-bearing values that sit right after a label versus right before one.
  const NUTRIENT = '(?:fat|protein|carb\\w*|sodium|fib(?:er|re)|sugars?|cholesterol)';
  const labelFirst = (text.match(new RegExp(`${NUTRIENT}\\s*:?\\s*\\d+(?:\\.\\d+)?\\s*(?:g|mg)\\b`, 'gi')) ?? []).length;
  const numberFirst = (text.match(new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:g|mg)\\s+${NUTRIENT}`, 'gi')) ?? []).length;
  const numberLeads = numberFirst > labelFirst;
  // Plain "Fat"/"Sugar" must not match "Saturated Fat"/"Added Sugars".
  const find = (label) => {
    const m = numberLeads
      ? new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(kcal|mg|g)?\\s+(?<!saturated |trans |added )${label}\\b`, 'i').exec(text)
      : new RegExp(`(?<!saturated |trans |added |total sugars? )\\b${label}\\b[^0-9]{0,15}(\\d+(?:\\.\\d+)?)\\s*(kcal|mg|g)?`, 'i').exec(text);
    return m ? { number: Number(m[1]), unit: m[2] } : null;
  };
  const LABELS = {
    Calories: 'calories',
    Fat: '(?:total )?fat',
    'Saturated fat': 'saturated fat',
    'Trans fat': 'trans fat',
    Cholesterol: 'cholesterol',
    Sodium: 'sodium',
    Carbohydrates: '(?:total )?carb(?:ohydrate)?s?',
    Fiber: '(?:dietary )?fib(?:er|re)',
    Sugar: 'sugars?',
    Protein: 'protein',
  };
  const found = Object.fromEntries(PANEL.map(([label, , unit]) => {
    const f = find(LABELS[label]);
    return [label, f ? { ...f, text: formatValue(`${f.number}${f.unit ?? ''}`, unit) } : null];
  }));
  const num = (label) => (found[label] ? Math.round(found[label].number) : null);
  const { macros, facts } = withCalories(
    { calories: num('Calories'), protein: num('Protein'), carbs: num('Carbohydrates'), fat: num('Fat') },
    PANEL.filter(([label]) => found[label]).map(([label]) => ({ label, value: found[label].text })),
  );
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  if (!title && Object.values(macros).every((v) => v === null)) return null;
  const serves = /(?:serves|servings?)\D{0,5}(\d{1,2})|(\d{1,2})\s*servings/i.exec(text);
  return {
    title: decode(title ?? '').replace(/\s*[|-]\s*Home Chef.*$/i, '').trim(),
    servings: serves ? Number(serves[1] ?? serves[2]) : 2,
    macros: Object.values(macros).every((v) => v !== null) ? macros : null,
    ingredients: [],
    facts,
  };
}

const cache = new Map();

// Ask like a normal browser; some sites turn away requests that don't look like one.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Try the name's slug, then the "-standard" variant Home Chef uses for some meals.
 * Always says why a lookup failed, so the app can tell "blocked" from "not found".
 * reason: 'not_found' | 'blocked' | 'no_nutrition' | 'network' | 'http_<status>'
 */
export async function lookupMeal(name) {
  const slug = slugify(name);
  if (!slug) return { found: false, reason: 'not_found' };
  if (cache.has(slug)) return cache.get(slug);
  let result = { found: false, url: `https://www.homechef.com/meals/${slug}`, reason: 'not_found' };
  for (const s of [slug, `${slug}-standard`]) {
    const url = `https://www.homechef.com/meals/${s}`;
    let res, html;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      html = await res.text();
    } catch (e) {
      result = { ...result, reason: 'network', detail: String(e.message ?? e) };
      console.log(`homechef ${s}: network error ${e.message ?? e}`);
      continue;
    }
    const challenged = /just a moment|cf-chl|captcha|access denied|attention required/i.test(html.slice(0, 5000));
    console.log(`homechef ${s}: HTTP ${res.status}${challenged ? ' (bot check page)' : ''}, ${html.length} bytes`);
    if (res.status === 404) continue;
    if ([401, 403, 429, 503].includes(res.status) || challenged) {
      result = { ...result, url, reason: 'blocked', status: res.status };
      break;
    }
    if (!res.ok) {
      result = { ...result, url, reason: `http_${res.status}`, status: res.status };
      continue;
    }
    const parsed = parseRecipePage(html);
    if (parsed?.macros) {
      result = { found: true, url, ...parsed };
      break;
    }
    result = { ...result, url, reason: 'no_nutrition', ...(parsed ?? {}) };
    break;
  }
  // Only remember successes, so a temporary block doesn't stick until the server restarts.
  if (result.found) cache.set(slug, result);
  return result;
}
