/**
 * Wholesale B2B Pricing — Discount Function
 *
 * ─── Architecture ────────────────────────────────────────────────────────────
 *
 * Configuration is stored in the discount-node metafield:
 *   namespace : "$app"
 *   key       : "tier_customer_tags"
 *   type      : "json"
 *   value     : JSON object:
 *               {
 *                 "tags": ["VIP", "Wholesale"],
 *                 "priceKey": "vip_pricing",
 *                 "qtyKey": "vip_pricing_min",
 *                 "tierName": "VIP Pricing"
 *               }
 *
 * Shopify automatically reads this metafield and supplies its top-level keys
 * as input query variables ($tags, $priceKey, $qtyKey) to cart_lines_discounts_generate_run.graphql.
 *
 * ─── Runtime Flow ────────────────────────────────────────────────────────────
 *  1. customer.hasAnyTag is evaluated dynamically by Shopify using the $tags variable.
 *     If the logged-in customer does not have any of the configured tags -> exit early.
 *  2. For every cart line:
 *       a. Read variant B2B price from b2b_price (dynamically selected via $priceKey).
 *       b. If no B2B price configured for this variant -> skip.
 *       c. Read variant minimum qty from b2b_min (dynamically selected via $qtyKey).
 *       d. If line.quantity < minQty -> skip.
 *       e. Calculate discount = (regularPricePerUnit - b2bPrice).
 *       f. Emit a productDiscountCandidate with fixed-amount applied to each item.
 *
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} FunctionResult
 */

import { ProductDiscountSelectionStrategy } from "../generated/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a Shopify money metafield stored as JSON: {"amount":"12.99","currency_code":"USD"}
 * or as a raw numeric string: "12.99".
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
function parseMoney(raw, presentmentCurrencyRate) {
  if (raw == null || raw === "") return null;

  let amount = raw;

  try {
    const parsed = JSON.parse(raw);

    amount =
      parsed !== null && typeof parsed === "object" ? parsed.amount : parsed;
  } catch {
    // Supports a raw numeric string such as "12.99".
  }

  const n = Number(amount) * Number(presentmentCurrencyRate);

  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse a Shopify integer metafield (stored as string e.g. "5").
 * @param {string|null|undefined} raw
 * @returns {number}
 */
function parseMinQty(raw) {
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Format a decimal number as a string with 2 decimal places.
 * @param {number} n
 * @returns {string}
 */
function toDecimalStr(n) {
  return n.toFixed(2);
}

// ─── Main function ─────────────────────────────────────────────────────────

/**
 * @param {RunInput} input
 * @returns {FunctionResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const NO_OPS = { operations: [] };

  // Guard: no cart lines
  if (!input.cart.lines || !input.cart.lines.length) return NO_OPS;

  // ── 1. Check buyer customer tags ─────────────────────────────────────────
  const customer = input.cart.buyerIdentity?.customer;
  const isVipCustomer = customer?.vip_tag;
  const presentmentCurrencyRate = input.presentmentCurrencyRate;

  if (!isVipCustomer) return NO_OPS;
  console.error(
    "Function triggered. Customer identity:",
    JSON.stringify(customer, null, 2),
  );
  console.error("Cart lines count:", input.cart.lines.length);

  // If no customer logged in, or customer does not have any of the configured tags
  // if (!customer || !customer.hasAnyTag) {
  //   return NO_OPS;
  // }

  // ── 2. Read tier title for discount label ────────────────────────────────
  let tierTitle = "B2B Pricing";
  const tierConfigRaw = input.discount?.tier_tags?.value;
  if (tierConfigRaw) {
    try {
      const parsed = JSON.parse(tierConfigRaw);
      if (parsed?.tierName) {
        tierTitle = parsed.tierName;
      }
    } catch {
      // fallback to default title
    }
  }

  // ── 3. Build discount candidates ─────────────────────────────────────────
  /** @type {import("../generated/api").ProductDiscountCandidate[]} */
  const candidates = [];

  for (const line of input.cart.lines) {
    const merch = line.merchandise;

    // Only handle known ProductVariant merchandise
    if (!merch || !merch.id) continue;

    // Read B2B price from the dynamically selected metafield ($priceKey)
    const b2bPrice = parseMoney(
      merch.b2b_price?.value,
      presentmentCurrencyRate,
    );
    if (b2bPrice === null) continue;

    // Read minimum quantity requirement from dynamically selected metafield ($qtyKey)
    const minQty = parseMinQty(merch.b2b_min) || 1;
    if (line.quantity < minQty) continue;

    // Compute regular price per unit from line cost
    const subtotal = parseFloat(line.cost?.subtotalAmount?.amount ?? "0");
    if (!Number.isFinite(subtotal) || subtotal <= 0) continue;

    const regularPricePerUnit = subtotal / line.quantity;

    // Only apply discount if B2B price is strictly less than regular price
    if (b2bPrice >= regularPricePerUnit) continue;

    const discountPerUnit = regularPricePerUnit - b2bPrice;

    candidates.push({
      message: tierTitle,
      targets: [
        {
          cartLine: {
            id: line.id,
          },
        },
      ],
      value: {
        fixedAmount: {
          amount: toDecimalStr(discountPerUnit),
          appliesToEachItem: true,
        },
      },
    });
  }

  if (!candidates.length) return NO_OPS;

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
