/**
 * Receipt photo → structured grocery line items, using Claude's vision and
 * structured outputs. The user always reviews the result before it's saved.
 */
import Anthropic from '@anthropic-ai/sdk';

const CATEGORIES = ['produce', 'meat', 'seafood', 'dairy', 'eggs', 'bakery', 'pantry', 'frozen', 'beverages', 'other'];
const LOCATIONS = ['fridge', 'freezer', 'pantry'];
const UNITS = ['count', 'g', 'kg', 'oz', 'lb', 'ml', 'l', 'cup', 'package'];
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const MODEL = process.env.RECEIPT_MODEL || 'claude-opus-5';
export const MAX_IMAGES = 8;

export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'date', 'items', 'total'],
  properties: {
    store: { type: 'string', description: 'Store name, or empty string if not visible' },
    date: { type: 'string', description: 'Purchase date as YYYY-MM-DD, or empty string if not visible' },
    total: { type: 'number', description: 'Receipt grand total, or 0 if not visible' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'receiptText', 'category', 'location', 'quantity', 'unit', 'price', 'isFood'],
        properties: {
          name: { type: 'string', description: 'Plain-English product name, e.g. "Boneless chicken breast"' },
          receiptText: { type: 'string', description: 'The line exactly as printed' },
          category: { type: 'string', enum: CATEGORIES },
          location: { type: 'string', enum: LOCATIONS },
          quantity: { type: 'number' },
          unit: { type: 'string', enum: UNITS },
          price: { type: 'number', description: 'Final price paid for this line after item-level discounts' },
          isFood: { type: 'boolean', description: 'false for bags, paper towels, cleaning supplies, etc.' },
        },
      },
    },
  },
};

const PROMPT = `These photos are one grocery receipt (possibly several overlapping photos of a long receipt, top to bottom).
Extract every purchased line item.

- Expand store abbreviations into plain names ("KRO BNLS SKNLS CHKN BRST" → "Boneless skinless chicken breast"). Keep the brand only when it matters for identifying the item.
- Weighed items ("2.13 lb @ 3.99 /lb"): quantity 2.13, unit "lb". Multi-buys ("2 @ 1.50"): quantity 2, unit "count". Otherwise quantity 1 with unit "count" or "package".
- Apply item-level savings/coupon lines printed right under an item to that item's price, so price is what was actually paid. Do not emit savings, coupon, tax, subtotal, total, payment, or loyalty lines as items.
- If photos overlap, don't list the same line twice.
- location: where it should be stored at home (frozen goods → freezer, shelf-stable → pantry, perishables → fridge; whole potatoes, onions, bananas → pantry).
- If a line is unreadable, make your best guess at the name and keep the price.`;

/** Clamp model output into the shapes the app expects. Exported for tests. */
export function cleanReceipt(raw) {
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({
      name: i.name.trim().slice(0, 120),
      receiptText: String(i.receiptText ?? '').slice(0, 120),
      category: pick(i.category, CATEGORIES, 'other'),
      location: pick(i.location, LOCATIONS, 'fridge'),
      quantity: num(i.quantity, 1) || 1,
      unit: pick(i.unit, UNITS, 'count'),
      price: Math.round(num(i.price) * 100) / 100,
      isFood: i.isFood !== false,
    }));
  return {
    store: typeof raw?.store === 'string' ? raw.store.slice(0, 80) : '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw?.date ?? '') ? raw.date : '',
    total: num(raw?.total),
    items,
  };
}

export function validateImages(images) {
  if (!Array.isArray(images) || images.length === 0) return 'Send at least one photo';
  if (images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} photos per receipt`;
  for (const img of images) {
    if (!MEDIA_TYPES.includes(img?.mediaType)) return 'Photos must be JPEG, PNG, WebP or GIF';
    if (typeof img.data !== 'string' || !img.data) return 'Photo data missing';
  }
  return null;
}

let client;

export async function scanReceipt(images) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          })),
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('The receipt could not be read. Try another photo.');
  if (response.stop_reason === 'max_tokens') throw new Error('Receipt too long. Scan it in two parts.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No result from the receipt reader');
  return cleanReceipt(JSON.parse(text));
}
