import { describe, expect, it } from 'vitest';
import { estimateCookBy, homeChefSlug, kitsByUrgency, parseHomeChefEmail, resolveDate } from '../src/lib/mealKits';
import { parseRecipePage, slugify } from '../server/homechef.mjs';

// The shipping email as pasted from Gmail (blank lines and non-breaking spaces included).
const EMAIL = `Hi Samantha,

Your Home Chef order is on its way and is scheduled to arrive by end of the day on Sunday, August 9. Remember, you do not have to be home to receive your delivery.

Upon delivery, take a look at each recipe card, as some ingredients should be stored at room temperature until you’re ready to cook.
  
  
 \t
Home Chef
  
 \t

Buttery Herb Chicken
  
 \t

Hot Honey Chicken Tacos
  
 \t

Sassy Sicilian Chicken
  
 \t

Teriyaki Salmon and Edamame
  
 \t

Southwest Blackened Chicken Salad
`;

describe('parseHomeChefEmail', () => {
  it('reads the meals and the delivery date from a shipping email', () => {
    const r = parseHomeChefEmail(EMAIL, '2026-09-24');
    expect(r.meals).toEqual([
      'Buttery Herb Chicken',
      'Hot Honey Chicken Tacos',
      'Sassy Sicilian Chicken',
      'Teriyaki Salmon and Edamame',
      'Southwest Blackened Chicken Salad',
    ]);
    expect(r.deliveredOn).toBe('2026-08-09'); // a Sunday in 2026
  });

  it('stops at the email footer', () => {
    const r = parseHomeChefEmail(`${EMAIL}\nManage your account\nUnsubscribe\nSome Footer Title Line`, '2026-09-24');
    expect(r.meals).toHaveLength(5);
  });

  it('does not mistake meal names containing "hi" for greetings', () => {
    expect(parseHomeChefEmail('Home Chef\nSushi Rice Bowl\nChicken Shawarma Plate', '2026-09-24').meals).toEqual([
      'Sushi Rice Bowl',
      'Chicken Shawarma Plate',
    ]);
  });
});

describe('resolveDate', () => {
  it('uses the weekday to pick the year', () => {
    expect(resolveDate(7, 9, 0, '2026-01-05')).toBe('2026-08-09'); // Sunday Aug 9 is 2026, not 2025
    expect(resolveDate(7, 9, 6, '2026-01-05')).toBe('2025-08-09'); // Saturday Aug 9 is 2025
    expect(resolveDate(0, 3, null, '2026-12-30')).toBe('2027-01-03'); // closest when no weekday
  });
});

describe('meal kit helpers', () => {
  it('cooks seafood first', () => {
    expect(estimateCookBy('Teriyaki Salmon and Edamame', '2026-08-09')).toBe('2026-08-11');
    expect(estimateCookBy('Buttery Herb Chicken', '2026-08-09')).toBe('2026-08-13');
    expect(estimateCookBy('Veggie Flatbread', '2026-08-09')).toBe('2026-08-14');
  });

  it('builds the same slug on client and server', () => {
    for (const n of ['Buttery Herb Chicken', "Chef's Mac & Cheese", 'Teriyaki Salmon and Edamame']) {
      expect(homeChefSlug(n)).toBe(slugify(n));
    }
    expect(slugify("Chef's Mac & Cheese")).toBe('chefs-mac-and-cheese');
  });

  it('orders active kits by cook-by date', () => {
    const base = { provider: 'Home Chef' as const, deliveredOn: '2026-08-09', servings: 2, price: 0 };
    const kits = kitsByUrgency([
      { ...base, name: 'A', cookBy: '2026-08-13', status: 'active' },
      { ...base, name: 'B', cookBy: '2026-08-11', status: 'active' },
      { ...base, name: 'C', cookBy: '2026-08-10', status: 'cooked' },
    ]);
    expect(kits.map((k) => k.name)).toEqual(['B', 'A']);
  });
});

// These fixtures are written from the schema.org Recipe format and a typical nutrition
// panel; they are not captured from homechef.com, whose markup couldn't be fetched here.
describe('parseRecipePage', () => {
  it('reads schema.org Recipe JSON-LD', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage' },
        {
          '@type': 'Recipe',
          name: 'Buttery Herb Chicken with butternut squash &amp; Brussels sprouts',
          recipeYield: '2 servings',
          recipeIngredient: ['2 Boneless Skinless Chicken Breasts', '1 Butternut Squash'],
          nutrition: {
            calories: '640 kcal',
            fatContent: '33 g',
            saturatedFatContent: '15 g',
            sodiumContent: '1290 mg',
            carbohydrateContent: '38 g',
            fiberContent: '8 g',
            proteinContent: '48 g',
          },
        },
      ],
    })}</script></head></html>`;
    expect(parseRecipePage(html)).toEqual({
      title: 'Buttery Herb Chicken with butternut squash & Brussels sprouts',
      servings: 2,
      macros: { calories: 640, protein: 48, carbs: 38, fat: 33 },
      ingredients: ['2 Boneless Skinless Chicken Breasts', '1 Butternut Squash'],
      facts: [
        { label: 'Calories', value: '640' },
        { label: 'Fat', value: '33g' },
        { label: 'Saturated fat', value: '15g' },
        { label: 'Sodium', value: '1290mg' },
        { label: 'Carbohydrates', value: '38g' },
        { label: 'Fiber', value: '8g' },
        { label: 'Protein', value: '48g' },
      ],
    });
  });

  it('reads schema.org microdata the way Home Chef marks it up', () => {
    // Shaped after the element found on homechef.com:
    // <strong class="textSm float-right" itemprop="carbohydrateContent">55g</strong>
    const row = (label: string, prop: string, value: string) =>
      `<li class="flex"><span class="textSm">${label}</span><strong class="textSm float-right" itemprop="${prop}">${value}</strong></li>`;
    const html = `<html><head><title>Buttery Herb Chicken | Home Chef</title></head><body itemscope itemtype="https://schema.org/Recipe">
      <h1 itemprop="name">Buttery Herb Chicken</h1><meta itemprop="recipeYield" content="2 servings">
      <ul itemprop="nutrition" itemscope itemtype="https://schema.org/NutritionInformation">
      ${row('Calories', 'calories', '650')}${row('Fat', 'fatContent', '34g')}${row('Saturated Fat', 'saturatedFatContent', '16g')}
      ${row('Cholesterol', 'cholesterolContent', '165mg')}${row('Sodium', 'sodiumContent', '1350mg')}
      ${row('Carbohydrates', 'carbohydrateContent', '55g')}${row('Fiber', 'fiberContent', '9g')}${row('Sugar', 'sugarContent', '12g')}
      ${row('Protein', 'proteinContent', '42g')}</ul></body></html>`;
    const r = parseRecipePage(html)!;
    expect(r.title).toBe('Buttery Herb Chicken');
    expect(r.servings).toBe(2);
    expect(r.macros).toEqual({ calories: 650, protein: 42, carbs: 55, fat: 34 });
    expect(r.facts).toContainEqual({ label: 'Carbohydrates', value: '55g' });
    expect(r.facts).toContainEqual({ label: 'Sodium', value: '1350mg' });
    expect(r.facts).toHaveLength(9);
  });

  it('falls back to a visible nutrition panel and ignores saturated fat and added sugars', () => {
    const html = `<title>Herb Butter Chicken | Home Chef</title><div>Serves 2</div>
      <ul><li>Calories 554</li><li>Saturated Fat 14g</li><li>Fat 31g</li><li>Cholesterol 150mg</li>
      <li>Sodium 1717mg</li><li>Carbohydrates 25g</li><li>Dietary Fiber 6g</li><li>Added Sugars 2g</li>
      <li>Sugar 7g</li><li>Protein 44g</li></ul>`;
    const r = parseRecipePage(html)!;
    expect(r).toMatchObject({ title: 'Herb Butter Chicken', servings: 2, macros: { calories: 554, protein: 44, carbs: 25, fat: 31 } });
    expect(r.facts).toEqual([
      { label: 'Calories', value: '554' },
      { label: 'Fat', value: '31g' },
      { label: 'Saturated fat', value: '14g' },
      { label: 'Cholesterol', value: '150mg' },
      { label: 'Sodium', value: '1717mg' },
      { label: 'Carbohydrates', value: '25g' },
      { label: 'Fiber', value: '6g' },
      { label: 'Sugar', value: '7g' },
      { label: 'Protein', value: '44g' },
    ]);
  });

  it('reads a panel written number-first', () => {
    const r = parseRecipePage('<title>X | Home Chef</title><p>620 Calories</p><p>40g Protein</p><p>51g Carbs</p><p>24g Fat</p><p>980mg Sodium</p>')!;
    expect(r.macros).toEqual({ calories: 620, protein: 40, carbs: 51, fat: 24 });
    expect(r.facts).toContainEqual({ label: 'Sodium', value: '980mg' });
  });

  it('returns no macros rather than partial ones', () => {
    expect(parseRecipePage('<title>Something | Home Chef</title><p>Calories 500</p>')?.macros).toBeNull();
  });
});

describe('kitPrices', () => {
  it('splits a box total across kits by servings, to the cent', async () => {
    const { kitPrices } = await import('../src/lib/mealKits');
    const five = kitPrices(116.32, 'box', [2, 2, 2, 2, 2]);
    expect(five).toEqual([23.27, 23.27, 23.26, 23.26, 23.26]);
    expect(Math.round(five.reduce((a, b) => a + b, 0) * 100)).toBe(11632);
    expect(kitPrices(60, 'box', [4, 2])).toEqual([40, 20]);
  });

  it('prices per kit or per serving', async () => {
    const { kitPrices } = await import('../src/lib/mealKits');
    expect(kitPrices(9.99, 'kit', [2, 4])).toEqual([9.99, 9.99]);
    expect(kitPrices(9.99, 'serving', [2, 4])).toEqual([19.98, 39.96]);
  });
});
