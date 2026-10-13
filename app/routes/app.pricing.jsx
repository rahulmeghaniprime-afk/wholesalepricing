/* eslint-disable react/prop-types */
import { authenticate } from "../shopify.server";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useRef, useEffect, Fragment } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseMoneyAmount(rawValue) {
  if (!rawValue) return null;
  try {
    const obj = JSON.parse(rawValue);
    return obj?.amount ?? null;
  } catch {
    return null;
  }
}

function editKey(variantId, mfKey) {
  return `${variantId}::${mfKey}`;
}

function mergeVariantsIntoEdits(editsMap, productsList, priceKey, qtyKey) {
  const nextEdits = { ...editsMap };
  for (const prod of productsList) {
    const variants = prod.variants?.nodes ?? [];
    for (const v of variants) {
      if (priceKey) {
        const pk = editKey(v.id, priceKey);
        if (!(pk in nextEdits)) {
          const mf = v.metafields?.nodes?.find((m) => m.key === priceKey);
          const orig = mf ? (parseMoneyAmount(mf.value) ?? v.price) : v.price;
          nextEdits[pk] = { value: orig, originalValue: orig, type: "money", key: priceKey, ownerId: v.id };
        }
      }
      if (qtyKey) {
        const qk = editKey(v.id, qtyKey);
        if (!(qk in nextEdits)) {
          const mfQ = v.metafields?.nodes?.find((m) => m.key === qtyKey);
          const origQ = mfQ?.value ?? "1";
          nextEdits[qk] = { value: origQ, originalValue: origQ, type: "number_integer", key: qtyKey, ownerId: v.id };
        }
      }
    }
  }
  return nextEdits;
}

// ─── Row Components ───────────────────────────────────────────────────────────

/**
 * ProductRow renders the 5 columns for a product:
 * 1. Image: Media preview thumbnail or default image icon
 * 2. Title: Product title and multi-variant badge with expand/collapse toggle
 * 3. Price: Editable B2B tier price (for single-variant) or price range (for multi-variant)
 * 4. Quantity: Editable Min Quantity (for single-variant) or "—" (rendered when qtyKey exists)
 * 5. Regular Price: Disabled variant regular price (for single-variant) or "—"
 */
function ProductRow({
  product,
  qtyKey,
  isExpanded,
  onToggleExpand,
  getPriceValue,
  getQtyValue,
  onPriceChange,
  onQtyChange,
  disabled,
}) {
  const count = product.variantsCount?.count ?? product.variants?.nodes?.length ?? 1;
  const isSingle = count === 1;
  const singleVariant = isSingle ? product.variants?.nodes?.[0] : null;
  const imageUrl = product?.media?.nodes?.[0]?.preview?.image?.url;

  return (
    <s-table-row>
      {/* 1. Image */}
      <s-table-cell>
        <s-grid maxInlineSize="40px" justifyContent="center">
          {imageUrl ? (
            <s-image
              alt={product.title}
              src={imageUrl}
              aspectRatio="1 / 1"
              objectFit="cover"
              borderRadius="base"
              inlineSize="fill"
            />
          ) : (
            <s-icon type="image" size="40" />
          )}
        </s-grid>
      </s-table-cell>

      {/* 2. Title */}
      <s-table-cell>
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{product.title}</s-text>
          {!isSingle && (
            <s-stack direction="inline" gap="small-400" justifyContent="start" alignItems="center">
              <s-badge tone="neutral">{count} variants</s-badge>
              <s-button
                variant="tertiary"
                icon={isExpanded ? "caret-down" : "caret-right"}
                onClick={() => onToggleExpand(product)}
              >
                {isExpanded ? "Hide variants" : "Show variants"}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-table-cell>

      {/* 3. Price (B2B Price) */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          {isSingle && singleVariant ? (
            <s-money-field
              value={getPriceValue(singleVariant)}
              min={0}
              disabled={disabled}
              onChange={(e) =>
                onPriceChange(singleVariant, e.currentTarget?.value ?? e.target?.value)
              }
            />
          ) : (
            <s-text tone="subdued">
              {product.priceRangeV2?.minVariantPrice?.amount} — {product.priceRangeV2?.maxVariantPrice?.amount}
            </s-text>
          )}
        </s-stack>
      </s-table-cell>

      {/* 4. Quantity (Min Quantity, when qtyKey exists) */}
      {qtyKey && (
        <s-table-cell>
          <s-stack maxInlineSize="90px">
            {isSingle && singleVariant ? (
              <s-number-field
                min={1}
                step={1}
                value={getQtyValue(singleVariant)}
                disabled={disabled}
                onChange={(e) =>
                  onQtyChange(singleVariant, e.currentTarget?.value ?? e.target?.value)
                }
              />
            ) : (
              <s-text tone="subdued">—</s-text>
            )}
          </s-stack>
        </s-table-cell>
      )}

      {/* 5. Disabled Regular Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          {isSingle && singleVariant ? (
            <s-money-field value={singleVariant.price} disabled />
          ) : (
            <s-text tone="subdued">—</s-text>
          )}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

/**
 * VariantRow renders the 5 columns for an expanded variant row:
 * 1. Image indicator (tree sub-arrow)
 * 2. Variant Title (indented)
 * 3. B2B Tier Price (editable money field)
 * 4. Min Quantity (editable integer field; rendered when qtyKey exists)
 * 5. Disabled Regular Price (disabled money field)
 */
function VariantRow({
  variant,
  qtyKey,
  getPriceValue,
  getQtyValue,
  onPriceChange,
  onQtyChange,
  disabled,
}) {
  return (
    <s-table-row key={variant.id}>
      {/* 1. Image / Sub-variant indicator */}
      <s-table-cell>
        <s-stack maxInlineSize="40px" justifyContent="center" alignItems="center">
          <s-text tone="subdued">↳</s-text>
        </s-stack>
      </s-table-cell>

      {/* 2. Title */}
      <s-table-cell>
        <s-box paddingInlineStart="base">
          <s-text tone="subdued">{variant.title}</s-text>
        </s-box>
      </s-table-cell>

      {/* 3. Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          <s-money-field
            value={getPriceValue(variant)}
            min={0}
            disabled={disabled}
            onChange={(e) =>
              onPriceChange(variant, e.currentTarget?.value ?? e.target?.value)
            }
          />
        </s-stack>
      </s-table-cell>

      {/* 4. Min Quantity (if qtyKey exists) */}
      {qtyKey && (
        <s-table-cell>
          <s-stack maxInlineSize="90px">
            <s-number-field
              min={1}
              step={1}
              value={getQtyValue(variant)}
              disabled={disabled}
              onChange={(e) =>
                onQtyChange(variant, e.currentTarget?.value ?? e.target?.value)
              }
            />
          </s-stack>
        </s-table-cell>
      )}

      {/* 5. Disabled Regular Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          <s-money-field value={variant.price} disabled />
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tierId = url.searchParams.get("id");
  const after = url.searchParams.get("after") || null;

  // Fetch products + metafield definitions + customer tags in parallel
  const [productsResponse, customerTagsResponse] = await Promise.all([
    admin.graphql(
      `#graphql
        query GetPricingData($after: String) {
          shop { currencyCode }
          metafieldDefinitions(first: 100, namespace: "$app", ownerType: PRODUCTVARIANT) {
            nodes { id key name type { name } }
          }
          products(first: 50, after: $after) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            nodes {
              id title
              media(first: 1) { nodes { preview { image { url } } } }
              priceRangeV2 {
                maxVariantPrice { amount }
                minVariantPrice { amount }
              }
              variantsCount { count }
              variants(first: 100) {
                nodes {
                  id title price
                  metafields(namespace: "$app", first: 100) {
                    nodes { id key type value }
                  }
                }
                pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
              }
            }
          }
        }
      `,
      { variables: { after } }
    ),
    // Fetch all customer tags for the tag picker
    admin.graphql(
      `#graphql
        query GetAllCustomerTags {
          shop {
            customerTags(first: 250) {
              nodes
            }
          }
        }
      `
    ),
  ]);

  const [data, tagsData] = await Promise.all([
    productsResponse.json(),
    customerTagsResponse.json(),
  ]);

  const defs = data?.data?.metafieldDefinitions?.nodes ?? [];
  const tierGid = `gid://shopify/MetafieldDefinition/${tierId}`;
  const tierDef = defs.find((d) => d.id === tierGid) ?? null;
  const priceKey = tierDef?.key ?? null;
  const qtyKey = priceKey ? `${priceKey}_min` : null;
  const qtyDef = qtyKey ? (defs.find((d) => d.key === qtyKey) ?? null) : null;

  // Fetch the current tier→tags config from the automatic discount metafield.
  // We need to find the discountNode that has the $app::tier_customer_tags metafield.
  // The metafield is stored on discountNodes; we fetch via discountNodes query.
  let savedTierTagsConfig = {};
  try {
    const discountMfResponse = await admin.graphql(
      `#graphql
        query GetDiscountTierTags {
          discountNodes(first: 10, query: "status:active") {
            nodes {
              id
              metafield(namespace: "$app", key: "tier_customer_tags") {
                id
                value
              }
            }
          }
        }
      `
    );
    const discountMfData = await discountMfResponse.json();
    // Find any discount node that has this metafield configured
    const discountNodes = discountMfData?.data?.discountNodes?.nodes ?? [];
    for (const node of discountNodes) {
      if (node.metafield?.value) {
        try {
          const parsed = JSON.parse(node.metafield.value);
          savedTierTagsConfig = parsed.tiers || parsed;
          break;
        } catch {
          // ignore parse error
        }
      }
    }
  } catch {
    // non-fatal: if we can't load saved config, start empty
  }

  const allCustomerTags = tagsData?.data?.shop?.customerTags?.nodes ?? [];

  return {
    tierId,
    tierDef,
    priceKey,
    qtyKey: qtyDef ? qtyKey : null,
    currencyCode: data?.data?.shop?.currencyCode ?? "USD",
    products: data?.data?.products?.nodes ?? [],
    pageInfo: data?.data?.products?.pageInfo ?? {},
    allCustomerTags,
    savedTierTagsConfig,
  };
};


// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Fetch paginated products
  if (intent === "fetchProducts") {
    const after = formData.get("after") || null;
    const prodResponse = await admin.graphql(
      `#graphql
        query GetPagedProducts($after: String) {
          products(first: 50, after: $after) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            nodes {
              id title
              media(first: 1) { nodes { preview { image { url } } } }
              priceRangeV2 {
                maxVariantPrice { amount }
                minVariantPrice { amount }
              }
              variantsCount { count }
              variants(first: 100) {
                nodes {
                  id title price
                  metafields(namespace: "$app", first: 100) {
                    nodes { id key type value }
                  }
                }
                pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
              }
            }
          }
        }
      `,
      { variables: { after } }
    );
    const prodData = await prodResponse.json();
    if (prodData.errors?.length) {
      return {
        intent: "fetchProducts",
        ok: false,
        error: prodData.errors.map((e) => e.message).join(", "),
        products: [],
        pageInfo: {},
      };
    }
    return {
      intent: "fetchProducts",
      ok: true,
      products: prodData?.data?.products?.nodes ?? [],
      pageInfo: prodData?.data?.products?.pageInfo ?? {},
    };
  }

  // Fetch paginated variants for an expanded product
  if (intent === "fetchVariants") {
    const productId = formData.get("productId");
    const after = formData.get("after") || null;
    const varResponse = await admin.graphql(
      `#graphql
        query GetProductVariants($productId: ID!, $after: String) {
          product(id: $productId) {
            variants(first: 100, after: $after) {
              nodes {
                id title price
                metafields(namespace: "$app", first: 100) {
                  nodes { id key type value }
                }
              }
              pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
            }
          }
        }
      `,
      { variables: { productId, after } }
    );
    const varData = await varResponse.json();
    if (varData.errors?.length) {
      return {
        intent: "fetchVariants",
        ok: false,
        error: varData.errors.map((e) => e.message).join(", "),
        productId,
        variants: [],
        pageInfo: {},
      };
    }
    return {
      intent: "fetchVariants",
      ok: true,
      productId,
      variants: varData?.data?.product?.variants?.nodes ?? [],
      pageInfo: varData?.data?.product?.variants?.pageInfo ?? {},
    };
  }

  // Save metafields in batches of 250 (Shopify official limit per mutation call)
  if (intent === "save") {
    const metafieldsRaw = formData.get("metafields");
    let metafields = [];
    try {
      metafields = JSON.parse(metafieldsRaw);
    } catch {
      return { intent: "save", ok: false, error: "Invalid metafields payload." };
    }
    if (!Array.isArray(metafields) || metafields.length === 0) {
      return { intent: "save", ok: true, saved: 0 };
    }
    const chunks = chunkArray(metafields, 250);
    const allSaved = [];
    const allErrors = [];
    for (const chunk of chunks) {
      const mutResponse = await admin.graphql(
        `#graphql
          mutation SaveMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key type value owner { ... on ProductVariant { id } } }
              userErrors { field message code }
            }
          }
        `,
        { variables: { metafields: chunk } }
      );
      const mutData = await mutResponse.json();
      if (mutData.errors?.length) {
        allErrors.push(...mutData.errors.map((e) => e.message));
      }
      const payload = mutData?.data?.metafieldsSet;
      if (payload?.userErrors?.length) {
        allErrors.push(...payload.userErrors.map((e) => e.message));
      }
      if (payload?.metafields?.length) {
        allSaved.push(...payload.metafields);
      }
    }
    if (allErrors.length) {
      return { intent: "save", ok: false, error: allErrors.join("; "), saved: allSaved.length };
    }
    return { intent: "save", ok: true, saved: allSaved.length };
  }

  // ── Save tier→customer tag config to the discount node metafield ─────────
  if (intent === "saveTierTags") {
    const tierKey = formData.get("tierKey");
    const tierName = formData.get("tierName") || tierKey;
    const tagsJson = formData.get("tagsJson");
    const discountNodeId = formData.get("discountNodeId");

    if (!tierKey) {
      return { intent: "saveTierTags", ok: false, error: "Missing tier key." };
    }

    let newTags = [];
    try {
      newTags = JSON.parse(tagsJson);
      if (!Array.isArray(newTags)) newTags = [];
    } catch {
      return { intent: "saveTierTags", ok: false, error: "Invalid tags payload." };
    }

    // Normalize tags: trim, deduplicate, filter empty
    newTags = [...new Set(newTags.map((t) => String(t).trim()).filter(Boolean))];

    // We need a discountNode to save the metafield on.
    // If no discountNodeId provided, find an existing active discount node or
    // use the first available one (the function-based automatic discount).
    let targetNodeId = discountNodeId || null;

    if (!targetNodeId) {
      // Find the first discount node associated with our function extension
      const findResponse = await admin.graphql(
        `#graphql
          query FindFunctionDiscountNode {
            discountNodes(first: 5, query: "status:active") {
              nodes {
                id
                metafield(namespace: "$app", key: "tier_customer_tags") {
                  id
                  value
                }
              }
            }
          }
        `
      );
      const findData = await findResponse.json();
      const nodes = findData?.data?.discountNodes?.nodes ?? [];
      // Prefer one that already has our metafield
      const withMf = nodes.find((n) => n.metafield?.value);
      targetNodeId = withMf?.id ?? nodes[0]?.id ?? null;
    }

    if (!targetNodeId) {
      try {
        const createResp = await admin.graphql(
          `#graphql
            mutation CreateWholesaleDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
              discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
                automaticAppDiscount {
                  discountId
                  title
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          {
            variables: {
              automaticAppDiscount: {
                title: "Wholesale B2B Pricing",
                functionHandle: "wholesale-price-discount",
                startsAt: new Date().toISOString(),
                context: {
                  all: "ALL"
                },
                combinesWith: {
                  orderDiscounts: true,
                  productDiscounts: true,
                  shippingDiscounts: true
                }
              },
            },
          }
        );
        const createData = await createResp.json();
        targetNodeId = createData?.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId ?? null;
      } catch (err) {
        console.error("Auto discount creation attempt failed:", err);
      }
    }

    if (!targetNodeId) {
      return {
        intent: "saveTierTags",
        ok: false,
        error: "No active discount found. Please create an automatic discount in Shopify Admin > Discounts using Wholesale Price Discount.",
      };
    }

    // Load existing config, merge with new tier tags, write back
    const readResponse = await admin.graphql(
      `#graphql
        query ReadTierTags($id: ID!) {
          discountNode(id: $id) {
            metafield(namespace: "$app", key: "tier_customer_tags") {
              id
              value
            }
          }
        }
      `,
      { variables: { id: targetNodeId } }
    );
    const readData = await readResponse.json();
    let currentConfig = {};
    const existingMf = readData?.data?.discountNode?.metafield;
    if (existingMf?.value) {
      try { currentConfig = JSON.parse(existingMf.value); } catch {}
    }

    // Merge: update current tier and provide top-level variables for input queries
    const tiersMap = currentConfig.tiers || { ...currentConfig };
    const updatedTiersMap = { ...tiersMap, [tierKey]: newTags };
    if (newTags.length === 0) {
      delete updatedTiersMap[tierKey];
    }

    const mergedConfig = {
      ...currentConfig,
      ...updatedTiersMap,
      tiers: updatedTiersMap,
      tags: newTags,
      priceKey: tierKey,
      qtyKey: `${tierKey}_min`,
      tierName,
    };

    const saveResponse = await admin.graphql(
      `#graphql
        mutation SaveTierTagsMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key value }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId: targetNodeId,
              namespace: "$app",
              key: "tier_customer_tags",
              type: "json",
              value: JSON.stringify(mergedConfig),
            },
          ],
        },
      }
    );
    const saveData = await saveResponse.json();
    const userErrors = saveData?.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length || saveData.errors?.length) {
      const msgs = [
        ...userErrors.map((e) => e.message),
        ...(saveData.errors ?? []).map((e) => e.message),
      ];
      return { intent: "saveTierTags", ok: false, error: msgs.join("; ") };
    }

    return {
      intent: "saveTierTags",
      ok: true,
      tierKey,
      savedTags: newTags,
      discountNodeId: targetNodeId,
      mergedConfig,
    };
  }

  return { ok: false, error: "Unknown intent." };
};

// ─── Should Revalidate ────────────────────────────────────────────────────────

export function shouldRevalidate(arg) {
  const intent = arg.formData?.get("intent") || arg.actionResult?.intent;
  if (
    intent === "fetchProducts" ||
    intent === "fetchVariants" ||
    intent === "save" ||
    intent === "saveTierTags"
  ) {
    return false;
  }
  return arg.defaultShouldRevalidate;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Pricing() {
  const loaderData = useLoaderData();
  const { tierDef, priceKey, qtyKey, currencyCode, allCustomerTags, savedTierTagsConfig } = loaderData;
  const fetcher = useFetcher();
  const tagsFetcher = useFetcher();

  // Products and product pagination state
  const [products, setProducts] = useState(loaderData.products ?? []);
  const [productPageInfo, setProductPageInfo] = useState(loaderData.pageInfo ?? {});
  const [productCursorHistory, setProductCursorHistory] = useState([null]);
  const [productPageLoading, setProductPageLoading] = useState(false);

  // Edit state: compositeKey → { value, originalValue, type, key, ownerId }
  const [edits, setEdits] = useState(() =>
    mergeVariantsIntoEdits({}, loaderData.products ?? [], priceKey, qtyKey)
  );

  // Expanded products: productId → { variants, pageInfo, cursorHistory, pageLoading }
  const [expandedProducts, setExpandedProducts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Customer Tag state ───────────────────────────────────────────────────
  // Tags currently configured for this tier (initialised from saved config)
  const initialTierTags = (savedTierTagsConfig ?? {})[priceKey] ?? [];
  const [tierTags, setTierTags] = useState(initialTierTags);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [customTagInput, setCustomTagInput] = useState("");
  const [tagsSaving, setTagsSaving] = useState(false);
  const [tagsSaveError, setTagsSaveError] = useState(null);
  const [tagsSaveSuccess, setTagsSaveSuccess] = useState(false);
  // Saved discountNodeId returned after first save (to avoid refetching)
  const [discountNodeId, setDiscountNodeId] = useState(null);

  // Keep tierTags in sync when loader returns a new savedTierTagsConfig
  // (e.g. after navigating to a different tier)
  const prevTierIdRef = useRef(loaderData.tierId);
  useEffect(() => {
    if (prevTierIdRef.current !== loaderData.tierId) {
      prevTierIdRef.current = loaderData.tierId;
      setTierTags((savedTierTagsConfig ?? {})[priceKey] ?? []);
      setTagsSaveError(null);
      setTagsSaveSuccess(false);
      setDiscountNodeId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.tierId]);

  const pendingFetchRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const pendingProductFetchRef = useRef(null);

  // ── Sync loader updates on tier change ───────────────────────────────────

  const currentTierIdRef = useRef(loaderData.tierId);
  useEffect(() => {
    if (currentTierIdRef.current !== loaderData.tierId) {
      currentTierIdRef.current = loaderData.tierId;
      setProducts(loaderData.products ?? []);
      setProductPageInfo(loaderData.pageInfo ?? {});
      setProductCursorHistory([null]);
      setExpandedProducts({});
      setEdits(mergeVariantsIntoEdits({}, loaderData.products ?? [], priceKey, qtyKey));
    }
  }, [loaderData.tierId, loaderData.products, loaderData.pageInfo, priceKey, qtyKey]);

  // ── Handle fetcher responses ─────────────────────────────────────────────

  useEffect(() => {
    if (!fetcher.data) return;

    // Handle product-level pagination responses
    if (fetcher.data.intent === "fetchProducts") {
      setProductPageLoading(false);
      const pending = pendingProductFetchRef.current;
      pendingProductFetchRef.current = null;
      if (fetcher.data.ok === false) {
        setSaveError(fetcher.data.error || "Failed to load products.");
        return;
      }
      const newProducts = fetcher.data.products ?? [];
      const newPageInfo = fetcher.data.pageInfo ?? {};
      setProducts(newProducts);
      setProductPageInfo(newPageInfo);

      if (pending?.direction === "next") {
        setProductCursorHistory((prev) => [...prev, pending.cursor]);
      } else if (pending?.direction === "prev") {
        setProductCursorHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }

      // Merge new products into edits (preserving already-edited values)
      setEdits((prevEdits) =>
        mergeVariantsIntoEdits(prevEdits, newProducts, priceKey, qtyKey)
      );
    }

    // Handle variant-level pagination responses for an expanded product
    if (fetcher.data.intent === "fetchVariants") {
      const pid = fetcher.data.productId;
      if (pendingFetchRef.current?.productId !== pid) return;
      const direction = pendingFetchRef.current.direction;
      pendingFetchRef.current = null;

      if (fetcher.data.ok === false) {
        setSaveError(fetcher.data.error || "Failed to load variants.");
        setExpandedProducts((prev) => ({
          ...prev,
          [pid]: { ...(prev[pid] ?? {}), pageLoading: false },
        }));
        return;
      }

      const newVariants = fetcher.data.variants ?? [];
      const newPageInfo = fetcher.data.pageInfo ?? {};

      setExpandedProducts((prev) => {
        const current = prev[pid] ?? { cursorHistory: [null] };
        let newHistory = [...(current.cursorHistory ?? [null])];
        if (direction === "next") {
          newHistory.push(newPageInfo.startCursor ?? null);
        } else if (direction === "prev") {
          newHistory.pop();
        }
        return {
          ...prev,
          [pid]: {
            variants: newVariants,
            pageInfo: newPageInfo,
            cursorHistory: newHistory,
            pageLoading: false,
          },
        };
      });

      // Merge new variants into edits without overwriting existing edits
      setEdits((prevEdits) => {
        const nextEdits = { ...prevEdits };
        for (const v of newVariants) {
          if (priceKey) {
            const pk = editKey(v.id, priceKey);
            if (!(pk in nextEdits)) {
              const mf = v.metafields?.nodes?.find((m) => m.key === priceKey);
              const orig = mf ? (parseMoneyAmount(mf.value) ?? v.price) : v.price;
              nextEdits[pk] = { value: orig, originalValue: orig, type: "money", key: priceKey, ownerId: v.id };
            }
          }
          if (qtyKey) {
            const qk = editKey(v.id, qtyKey);
            if (!(qk in nextEdits)) {
              const mfQ = v.metafields?.nodes?.find((m) => m.key === qtyKey);
              const origQ = mfQ?.value ?? "1";
              nextEdits[qk] = { value: origQ, originalValue: origQ, type: "number_integer", key: qtyKey, ownerId: v.id };
            }
          }
        }
        return nextEdits;
      });
    }

    // Handle save response
    if (fetcher.data.intent === "save" && pendingSaveRef.current) {
      pendingSaveRef.current = false;
      setSaving(false);
      if (fetcher.data.ok) {
        setSaveSuccess(true);
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show("Pricing saved successfully!");
        }
        // Commit: current values become the new baseline original values
        setEdits((prev) => {
          const next = {};
          for (const [k, entry] of Object.entries(prev)) {
            next[k] = { ...entry, originalValue: entry.value };
          }
          return next;
        });
      } else {
        setSaveError(fetcher.data.error ?? "Save failed.");
      }
    }
  }, [fetcher.data, priceKey, qtyKey]);

  // ── Handle tagsFetcher responses (saveTierTags) ──────────────────────────

  useEffect(() => {
    if (!tagsFetcher.data) return;
    if (tagsFetcher.data.intent === "saveTierTags") {
      setTagsSaving(false);
      if (tagsFetcher.data.ok) {
        setTagsSaveSuccess(true);
        setTagsSaveError(null);
        // Cache the discountNodeId so subsequent saves are faster
        if (tagsFetcher.data.discountNodeId) {
          setDiscountNodeId(tagsFetcher.data.discountNodeId);
        }
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show("Customer tags saved successfully!");
        }
      } else {
        setTagsSaveError(tagsFetcher.data.error ?? "Failed to save tags.");
      }
    }
  }, [tagsFetcher.data]);


  // ── No tier found guard ──────────────────────────────────────────────────

  if (!tierDef || !priceKey) {
    return (
      <s-page heading="B2B Pricing">
        <s-section>
          <s-banner tone="critical">
            Pricing tier not found. Please go back to Tier Pricings and select a valid tier.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  // ── Value getters ────────────────────────────────────────────────────────

  const getPriceValue = (variant) => {
    if (!variant) return "0.00";
    const k = editKey(variant.id, priceKey);
    if (k in edits) return edits[k].value ?? variant.price;
    const mf = variant.metafields?.nodes?.find((m) => m.key === priceKey);
    return mf ? (parseMoneyAmount(mf.value) ?? variant.price) : variant.price;
  };

  const getQtyValue = (variant) => {
    if (!qtyKey || !variant) return "1";
    const k = editKey(variant.id, qtyKey);
    if (k in edits) return edits[k].value ?? "1";
    const mf = variant.metafields?.nodes?.find((m) => m.key === qtyKey);
    return mf?.value ?? "1";
  };

  // ── Edit handlers ────────────────────────────────────────────────────────

  const handlePriceChange = (variant, newValue) => {
    const k = editKey(variant.id, priceKey);
    setEdits((prev) => {
      const existing = prev[k];
      const mf = variant.metafields?.nodes?.find((m) => m.key === priceKey);
      const orig = existing?.originalValue ?? (mf ? (parseMoneyAmount(mf?.value) ?? variant.price) : variant.price);
      return {
        ...prev,
        [k]: { value: newValue, originalValue: orig, type: "money", key: priceKey, ownerId: variant.id },
      };
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleQtyChange = (variant, newValue) => {
    if (!qtyKey) return;
    const k = editKey(variant.id, qtyKey);
    setEdits((prev) => {
      const existing = prev[k];
      const mf = variant.metafields?.nodes?.find((m) => m.key === qtyKey);
      const orig = existing?.originalValue ?? (mf?.value ?? "1");
      return {
        ...prev,
        [k]: {
          value: newValue === "" ? "1" : String(newValue),
          originalValue: orig,
          type: "number_integer",
          key: qtyKey,
          ownerId: variant.id,
        },
      };
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  // ── Product-level Pagination ─────────────────────────────────────────────

  const loadProductPage = (cursor, direction) => {
    setProductPageLoading(true);
    setSaveError(null);
    setSaveSuccess(false);
    pendingProductFetchRef.current = { cursor, direction };
    const fd = new FormData();
    fd.append("intent", "fetchProducts");
    if (cursor) {
      fd.append("after", cursor);
    }
    fetcher.submit(fd, { method: "POST" });
  };

  const handleNextProductPage = () => {
    if (!productPageInfo?.hasNextPage || productPageLoading || saving) return;
    const nextCursor = productPageInfo.endCursor;
    loadProductPage(nextCursor, "next");
  };

  const handlePrevProductPage = () => {
    if (productCursorHistory.length <= 1 || productPageLoading || saving) return;
    const prevCursor = productCursorHistory[productCursorHistory.length - 2];
    loadProductPage(prevCursor, "prev");
  };

  // ── Variant-level Expansion & Pagination ──────────────────────────────────

  const toggleVariants = (product) => {
    const pid = product.id;
    if (expandedProducts[pid]) {
      setExpandedProducts((prev) => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      return;
    }
    setExpandedProducts((prev) => ({
      ...prev,
      [pid]: {
        variants: product.variants?.nodes ?? [],
        pageInfo: product.variants?.pageInfo ?? {},
        cursorHistory: [null],
        pageLoading: false,
      },
    }));
  };

  const loadVariantPage = (productId, afterCursor, direction) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], pageLoading: true },
    }));
    pendingFetchRef.current = { productId, direction };
    const fd = new FormData();
    fd.append("intent", "fetchVariants");
    fd.append("productId", productId);
    if (afterCursor) fd.append("after", afterCursor);
    fetcher.submit(fd, { method: "POST" });
  };

  const handleNextVariantPage = (productId) => {
    const state = expandedProducts[productId];
    if (!state || !state.pageInfo?.hasNextPage) return;
    loadVariantPage(productId, state.pageInfo.endCursor, "next");
  };

  const handlePrevVariantPage = (productId) => {
    const state = expandedProducts[productId];
    if (!state || (state.cursorHistory?.length ?? 0) <= 1) return;
    const prevCursor = state.cursorHistory[state.cursorHistory.length - 2];
    loadVariantPage(productId, prevCursor, "prev");
  };

  // ── Cancel ───────────────────────────────────────────────────────────────

  const handleCancel = () => {
    setEdits((prev) => {
      const reset = {};
      for (const [k, entry] of Object.entries(prev)) {
        reset[k] = { ...entry, value: entry.originalValue };
      }
      return reset;
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (saving) return;
    setSaveError(null);
    setSaveSuccess(false);

    const metafieldsToSave = [];
    for (const [, entry] of Object.entries(edits)) {
      if (String(entry.value ?? "") === String(entry.originalValue ?? "")) continue;
      let serialized;
      if (entry.type === "money") {
        const amount = String(entry.value ?? "").trim();
        if (!amount) continue;
        const n = Number(amount);
        if (!Number.isFinite(n) || n < 0) {
          setSaveError(`Invalid price: ${amount}`);
          return;
        }
        serialized = JSON.stringify({ amount, currency_code: currencyCode });
      } else if (entry.type === "number_integer") {
        const n = Number(entry.value);
        if (!Number.isInteger(n) || n < 1) {
          setSaveError("Min quantity must be a whole number ≥ 1.");
          return;
        }
        serialized = String(n);
      } else {
        serialized = String(entry.value ?? "");
      }
      metafieldsToSave.push({
        key: entry.key,
        ownerId: entry.ownerId,
        type: entry.type,
        namespace: "$app",
        value: serialized,
      });
    }

    if (metafieldsToSave.length === 0) {
      setSaveSuccess(true);
      return;
    }

    setSaving(true);
    pendingSaveRef.current = true;
    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("metafields", JSON.stringify(metafieldsToSave));
    fetcher.submit(fd, { method: "POST" });
  };

  const hasChanges = Object.values(edits).some(
    (e) => String(e.value ?? "") !== String(e.originalValue ?? "")
  );

  // ── Customer Tag Handlers ────────────────────────────────────────────────

  const handleAddCustomTags = () => {
    if (!customTagInput.trim()) return;
    const rawTags = customTagInput.split(",");
    const newTags = rawTags
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (newTags.length === 0) return;

    setTierTags((prev) => {
      const existingLower = new Set(prev.map((t) => t.toLowerCase()));
      const toAdd = newTags.filter((t) => !existingLower.has(t.toLowerCase()));
      return [...prev, ...toAdd];
    });

    setCustomTagInput("");
    setTagsSaveSuccess(false);
    setTagsSaveError(null);
  };

  const handleTogglePickerTag = (tag) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setTierTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === trimmed.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase());
      } else {
        return [...prev, trimmed];
      }
    });
    setTagsSaveSuccess(false);
    setTagsSaveError(null);
  };

  const handleRemoveTag = (tagToRemove) => {
    setTierTags((prev) => prev.filter((t) => t !== tagToRemove));
    setTagsSaveSuccess(false);
    setTagsSaveError(null);
  };

  const handleClearAllTags = () => {
    setTierTags([]);
    setTagsSaveSuccess(false);
    setTagsSaveError(null);
  };

  const handleSaveTierTags = () => {
    if (tagsSaving) return;
    setTagsSaving(true);
    setTagsSaveError(null);
    setTagsSaveSuccess(false);

    const fd = new FormData();
    fd.append("intent", "saveTierTags");
    fd.append("tierKey", priceKey);
    fd.append("tierName", tierDef?.name ?? priceKey);
    fd.append("tagsJson", JSON.stringify(tierTags));
    if (discountNodeId) {
      fd.append("discountNodeId", discountNodeId);
    }
    tagsFetcher.submit(fd, { method: "POST" });
  };

  const savedTagsForThisTier = (savedTierTagsConfig ?? {})[priceKey] ?? [];
  const savedTagsSet = new Set(savedTagsForThisTier);
  const hasTagChanges =
    tierTags.length !== savedTagsForThisTier.length ||
    tierTags.some((t) => !savedTagsSet.has(t));

  const filteredCustomerTags = (allCustomerTags || []).filter((tag) =>
    tag.toLowerCase().includes(pickerSearch.toLowerCase().trim())
  );

  // ── Sync shopify.saveBar with dirty state (hasChanges) ───────────────────

  const saveBarId = "pricing-save-bar";

  useEffect(() => {
    if (typeof shopify !== "undefined" && shopify.saveBar) {
      if (hasChanges) {
        shopify.saveBar.show(saveBarId);
      } else {
        shopify.saveBar.hide(saveBarId);
      }
    }
  }, [hasChanges]);

  // Hide save bar on component unmount
  useEffect(() => {
    return () => {
      if (typeof shopify !== "undefined" && shopify.saveBar) {
        shopify.saveBar.hide(saveBarId);
      }
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <s-page heading={`${tierDef.name} — B2B Pricing`}>
      <ui-save-bar id={saveBarId}>
        <button
          variant="primary"
          onClick={handleSave}
          disabled={saving || productPageLoading}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleCancel}
          disabled={saving || productPageLoading}
        >
          Discard
        </button>
      </ui-save-bar>

      {saveError && <s-banner tone="critical">{saveError}</s-banner>}
      {saveSuccess && <s-banner tone="success">Pricing saved successfully!</s-banner>}

      {/* ── Customer Tags Section ────────────────────────────────────────── */}
      <s-section heading="Eligible Customer Tags">
        <s-stack direction="block" gap="base">
          <s-text tone="subdued">
            Select or enter customer tags for this tier. Logged-in customers with any of these tags will automatically receive <strong>{tierDef.name}</strong> pricing at checkout.
            These tags are saved to the Shopify discount function metafield.
          </s-text>

          {tagsSaveError && (
            <s-banner tone="critical">{tagsSaveError}</s-banner>
          )}
          {tagsSaveSuccess && (
            <s-banner tone="success">Customer tags for {tierDef.name} saved successfully!</s-banner>
          )}

          {/* Action Row: Picker toggle, Custom Tag input, and Save button */}
          <s-stack direction="inline" gap="base" alignItems="end" wrap>
            <s-button
              variant="secondary"
              onClick={() => setTagPickerOpen((prev) => !prev)}
            >
              {tagPickerOpen
                ? "Close Tag Picker"
                : `Select Store Tags (${allCustomerTags.length})`}
            </s-button>

            <s-stack direction="inline" gap="small" alignItems="center" inlineSize="fill" maxInlineSize="460px">
              <s-text-field
                label="Custom Tags (comma separated)"
                placeholder="e.g. wholesale, b2b_vip, gold_member"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.currentTarget?.value ?? e.target?.value ?? "")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomTags();
                  }
                }}
              />
              <s-button
                variant="secondary"
                onClick={handleAddCustomTags}
                disabled={!customTagInput.trim()}
              >
                Add
              </s-button>
            </s-stack>

            <s-button
              variant="primary"
              onClick={handleSaveTierTags}
              disabled={tagsSaving || (!hasTagChanges && tagsSaveSuccess)}
              loading={tagsSaving}
            >
              {tagsSaving ? "Saving..." : "Save Customer Tags"}
            </s-button>
          </s-stack>

          {/* Tag Picker Panel */}
          {tagPickerOpen && (
            <s-box
              padding="base"
              borderRadius="base"
              border="base"
            >
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-text type="strong">Existing Customer Tags ({allCustomerTags.length})</s-text>
                  <s-button
                    variant="tertiary"
                    onClick={() => setTagPickerOpen(false)}
                  >
                    Done
                  </s-button>
                </s-stack>

                <s-text-field
                  placeholder="Filter store tags..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.currentTarget?.value ?? e.target?.value ?? "")}
                />

                {filteredCustomerTags.length === 0 ? (
                  <s-box padding="small">
                    <s-text tone="subdued">
                      {allCustomerTags.length === 0
                        ? "No customer tags found in store. You can add custom tags using the field above."
                        : "No matching tags found."}
                    </s-text>
                  </s-box>
                ) : (
                  <s-stack direction="inline" gap="small" wrap>
                    {filteredCustomerTags.map((tag) => {
                      const isSelected = tierTags.some(
                        (t) => t.toLowerCase() === tag.toLowerCase()
                      );
                      return (
                        <s-clickable
                          key={tag}
                          padding="small-300"
                          borderRadius="base"
                          border="base"
                          onClick={() => handleTogglePickerTag(tag)}
                        >
                          <s-stack direction="inline" gap="small-300" alignItems="center">
                            <s-text type={isSelected ? "strong" : "generic"}>
                              {isSelected ? "✓ " : "+ "}
                              {tag}
                            </s-text>
                          </s-stack>
                        </s-clickable>
                      );
                    })}
                  </s-stack>
                )}
              </s-stack>
            </s-box>
          )}

          {/* Configured Tags List Display */}
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text type="strong">
                  Configured Tags ({tierTags.length}):
                </s-text>
                {hasTagChanges && (
                  <s-badge tone="attention">Unsaved tag changes</s-badge>
                )}
              </s-stack>
              {tierTags.length > 0 && (
                <s-button variant="tertiary" onClick={handleClearAllTags}>
                  Clear All Tags
                </s-button>
              )}
            </s-stack>

            {tierTags.length === 0 ? (
              <s-box padding="base" border="base" borderRadius="base">
                <s-text tone="subdued">
                  No tags configured for {tierDef.name}. Select from store tags or add custom comma-separated tags above.
                </s-text>
              </s-box>
            ) : (
              <s-stack direction="inline" gap="small" wrap alignItems="center">
                {tierTags.map((tag) => (
                  <s-badge key={tag} tone="info">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text>{tag}</s-text>
                      <s-clickable
                        role="button"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <s-text type="strong" tone="critical"> × </s-text>
                      </s-clickable>
                    </s-stack>
                  </s-badge>
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      {/* ── Products Pricing Table Section ───────────────────────────────── */}
      <s-section>

        <s-table>
          <s-table-header-row>
            <s-table-header></s-table-header>
            <s-table-header>Product / Variant</s-table-header>
            <s-table-header>{tierDef.name} ({currencyCode})</s-table-header>
            {qtyKey && <s-table-header>Min Qty</s-table-header>}
            <s-table-header>Regular Price</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {products.length === 0 ? (
              <s-table-row>
                <s-table-cell colSpan={qtyKey ? 5 : 4}>
                  <s-box padding="base">
                    <s-text tone="subdued">No products found.</s-text>
                  </s-box>
                </s-table-cell>
              </s-table-row>
            ) : (
              products.map((product) => {
                const expanded = expandedProducts[product.id];

                return (
                  <Fragment key={product.id}>
                    {/* Component for Product 5-column row */}
                    <ProductRow
                      product={product}
                      qtyKey={qtyKey}
                      isExpanded={Boolean(expanded)}
                      onToggleExpand={toggleVariants}
                      getPriceValue={getPriceValue}
                      getQtyValue={getQtyValue}
                      onPriceChange={handlePriceChange}
                      onQtyChange={handleQtyChange}
                      disabled={saving || productPageLoading}
                    />

                    {/* Expanded variant sub-rows */}
                    {expanded && (
                      <>
                        {expanded.pageLoading ? (
                          <s-table-row key={`${product.id}-loading`}>
                            <s-table-cell colSpan={qtyKey ? 5 : 4}>
                              <s-stack direction="inline" gap="small" alignItems="center" padding="small">
                                <s-spinner size="small" />
                                <s-text tone="subdued">Loading variants...</s-text>
                              </s-stack>
                            </s-table-cell>
                          </s-table-row>
                        ) : (
                          expanded.variants.map((variant) => (
                            /* Component for Variant 5-column row */
                            <VariantRow
                              key={variant.id}
                              variant={variant}
                              qtyKey={qtyKey}
                              getPriceValue={getPriceValue}
                              getQtyValue={getQtyValue}
                              onPriceChange={handlePriceChange}
                              onQtyChange={handleQtyChange}
                              disabled={saving || productPageLoading}
                            />
                          ))
                        )}

                        {/* Variant pagination */}
                        {((expanded.pageInfo?.hasNextPage) || (expanded.cursorHistory?.length ?? 0) > 1) && (
                          <s-table-row key={`${product.id}-pagination`}>
                            <s-table-cell colSpan={qtyKey ? 5 : 4}>
                              <s-stack direction="inline" gap="base" justifyContent="center" alignItems="center" padding="small">
                                <s-button
                                  variant="tertiary"
                                  disabled={(expanded.cursorHistory?.length ?? 0) <= 1 || expanded.pageLoading}
                                  onClick={() => handlePrevVariantPage(product.id)}
                                >
                                  ← Previous Variants
                                </s-button>
                                <s-text tone="subdued">
                                  Variant Page {expanded.cursorHistory?.length ?? 1}
                                </s-text>
                                <s-button
                                  variant="tertiary"
                                  disabled={!expanded.pageInfo?.hasNextPage || expanded.pageLoading}
                                  onClick={() => handleNextVariantPage(product.id)}
                                >
                                  Next Variants →
                                </s-button>
                              </s-stack>
                            </s-table-cell>
                          </s-table-row>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })
            )}
          </s-table-body>
        </s-table>

        {/* Product Pagination Bar */}
        <s-stack
          direction="inline"
          gap="base"
          justifyContent="space-between"
          alignItems="center"
          paddingBlockStart="base"
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text tone="subdued">
              Product Page {productCursorHistory.length}
            </s-text>
            {productPageLoading && (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-spinner size="small" />
                <s-text tone="subdued">Loading products...</s-text>
              </s-stack>
            )}
          </s-stack>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              variant="secondary"
              disabled={productCursorHistory.length <= 1 || productPageLoading || saving}
              onClick={handlePrevProductPage}
            >
              ← Previous Products
            </s-button>
            <s-button
              variant="secondary"
              disabled={!productPageInfo?.hasNextPage || productPageLoading || saving}
              onClick={handleNextProductPage}
            >
              Next Products →
            </s-button>
          </s-stack>
        </s-stack>

      </s-section>
        {hasChanges && (
          <s-stack direction="inline" gap="base" justifyContent="end" alignItems="center" paddingBlockStart="base">
            <s-button variant="secondary" onClick={handleCancel} disabled={saving || productPageLoading}>
              Cancel
            </s-button>
            <s-button
              variant="primary"
              onClick={handleSave}
              disabled={saving || productPageLoading}
              {...(saving ? { loading: true } : {})}
            >
              {saving ? "Saving..." : "Save"}
            </s-button>
          </s-stack>
        )}
    </s-page>
  );
}