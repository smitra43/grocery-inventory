/**
 * Look up a Home Chef recipe page by meal name and pull out servings, per-serving
 * macros and ingredients. Home Chef has no API; recipe pages are public at
 * https://www.homechef.com/meals/<slug>. Parsing prefers schema.org Recipe JSON-LD and
 * falls back to matching nutrition text, so a page redesign degrades to "not found"
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

/** Returns { title, servings, macros|null, ingredients[] } or null if the page isn't a recipe. */
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
    const macros = {
      calories: firstNumber(n.calories),
      protein: firstNumber(n.proteinContent),
      carbs: firstNumber(n.carbohydrateContent),
      fat: firstNumber(n.fatContent),
    };
    return {
      title: decode(String(r.name ?? '')),
      servings: firstNumber(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield) ?? 2,
      macros: Object.values(macros).every((v) => v !== null) ? macros : null,
      ingredients: Array.isArray(r.recipeIngredient) ? r.recipeIngredient.map((i) => decode(String(i))) : [],
    };
  }

  // 2. Visible text, e.g. "Calories 554 · Protein 44g · Carbohydrates 25g · Fat 31g"
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const grab = (label) => {
    const before = new RegExp(`(?<!saturated |trans )\\b${label}\\b[^0-9]{0,15}(\\d+(?:\\.\\d+)?)`, 'i').exec(text);
    const after = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:g|mg|kcal)?\\s*(?<!saturated )${label}\\b`, 'i').exec(text);
    const m = before ?? after;
    return m ? Math.round(Number(m[1])) : null;
  };
  const macros = { calories: grab('calories'), protein: grab('protein'), carbs: grab('carb(?:ohydrate)?s?'), fat: grab('fat') };
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
  if (!title && Object.values(macros).every((v) => v === null)) return null;
  const serves = /(?:serves|servings?)\D{0,5}(\d{1,2})|(\d{1,2})\s*servings/i.exec(text);
  return {
    title: decode(title ?? '').replace(/\s*[|-]\s*Home Chef.*$/i, '').trim(),
    servings: serves ? Number(serves[1] ?? serves[2]) : 2,
    macros: Object.values(macros).every((v) => v !== null) ? macros : null,
    ingredients: [],
  };
}

const cache = new Map();

/** Try the name's slug, then the "-standard" variant Home Chef uses for some meals. */
export async function lookupMeal(name) {
  const slug = slugify(name);
  if (!slug) return { found: false };
  if (cache.has(slug)) return cache.get(slug);
  let result = { found: false, url: `https://www.homechef.com/meals/${slug}` };
  for (const s of [slug, `${slug}-standard`]) {
    const url = `https://www.homechef.com/meals/${s}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (personal grocery app)', Accept: 'text/html' } });
    if (!res.ok) continue;
    const parsed = parseRecipePage(await res.text());
    if (parsed) {
      result = { found: true, url, ...parsed };
      break;
    }
  }
  cache.set(slug, result);
  return result;
}
