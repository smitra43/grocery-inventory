/**
 * "Send to Larder" bookmarklet for kroger.com → Purchases → a receipt.
 * It runs in the user's own logged-in browser tab (no password, no server scraping),
 * reads the receipt from the page, and opens the app with the text in the URL hash,
 * formatted the way the digital-receipt parser expects.
 *
 * Page structure (as inspected on kroger.com):
 *   <div class="mt-8 mb-4">
 *     <div class="flex justify-between"><span>Fromage d'Affinois Cheese, 1 lb</span><span>$3.71</span></div>
 *     <div class="ml-12 mt-4"><span>0.18 lbs x $20.61 each (approx.)</span></div>
 *     <div class="ml-12 mt-4 …">UPC: 0029647610000</div>
 *   </div>
 * Items are found by their "UPC:" line rather than by class names, which change more often.
 */

export const IMPORT_HASH = '#import=';

/** Runs on the Kroger page. Must be self-contained: it is serialized into the bookmarklet. */
export function extractKrogerReceipt(appUrl: string): void {
  const text = (el: Element | null) => ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];

  // Order date / total / tax: the label and its value may be separate lines in innerText.
  const all = (document.body.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  all.forEach((line, i) => {
    if (/^(order date|order total|sales tax|original item total|item coupons)/i.test(line)) {
      out.push(/\$\s*[\d,]+\.\d{2}|\d{4}/.test(line) ? line : `${line} ${all[i + 1] ?? ''}`);
    }
  });

  out.push('Item Details');
  const upcs = Array.from(document.querySelectorAll('div, span, p')).filter(
    (el) => el.children.length === 0 && /^UPC\s*:/i.test(text(el)),
  );
  for (const upc of upcs) {
    const block = upc.parentElement;
    if (!block) continue;
    const rows = Array.from(block.children);
    const head = rows[0];
    const spans = head ? Array.from(head.querySelectorAll('span')) : [];
    const name = spans.length > 1 ? text(spans[0]) : text(head);
    const price = spans.length > 1 ? text(spans[spans.length - 1]) : '';
    out.push(`${name} ${price}`.trim());
    for (const row of rows.slice(1)) out.push(text(row));
  }
  out.push('Payment Details');

  // Nothing matched (page layout changed): send the whole page text; the parser copes with it.
  const payload = upcs.length ? out : all;
  location.href = appUrl + '#import=' + encodeURIComponent(payload.join('\n'));
}

/** The javascript: URL for a bookmark, pointing back at this app. */
export function bookmarkletUrl(appUrl: string): string {
  return 'javascript:' + encodeURIComponent(`(${extractKrogerReceipt.toString()})(${JSON.stringify(appUrl)})`);
}

/** Pull receipt text handed over by the bookmarklet from the URL hash, and clear it. */
export function takeImportFromHash(): string | null {
  if (!location.hash.startsWith(IMPORT_HASH)) return null;
  let text: string | null = null;
  try {
    text = decodeURIComponent(location.hash.slice(IMPORT_HASH.length));
  } catch {
    text = null;
  }
  try {
    history.replaceState(null, '', '#inventory');
  } catch {
    // ignore
  }
  return text;
}
