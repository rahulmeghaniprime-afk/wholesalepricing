/**
 * discount.server.js
 *
 * Ensures the Wholesale B2B Pricing automatic discount:
 * 1. Exists
 * 2. Is connected to the correct Shopify Function
 * 3. Has PRODUCT discount class
 * 4. Is ACTIVE
 * 5. Has the $app:tier_customer_tags configuration metafield
 *
 * Runs on every app load.
 *
 * IMPORTANT:
 * - Requires read_discounts + write_discounts scopes.
 * - Detailed logs are intentionally included for debugging Shopify
 *   activation failures.
 */

const DISCOUNT_TITLE = "Wholesale B2B Pricing";
const FUNCTION_HANDLE = "wholesale-price-discount";

const METAFIELD_NAMESPACE = "$app";
const METAFIELD_KEY = "tier_customer_tags";

const DEFAULT_CONFIG = {
  tags: [],
  priceKey: "vip_pricing",
  qtyKey: "vip_pricing_min",
  tierName: "VIP Customer Pricing",
  tiers: {},
};

/**
 * ---------------------------------------------------------
 * LOG HELPERS
 * ---------------------------------------------------------
 */

function log(...args) {
  console.log("[Wholesale Discount]", ...args);
}

function warn(...args) {
  console.warn("[Wholesale Discount]", ...args);
}

function errorLog(...args) {
  console.error("[Wholesale Discount]", ...args);
}

function pretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * ---------------------------------------------------------
 * GRAPHQL ERROR HELPERS
 * ---------------------------------------------------------
 */

function ensureNoGraphQLErrors(json, operationName) {
  if (!json?.errors?.length) {
    return;
  }

  const message = json.errors
    .map((err) => {
      return [
        err?.message ? `Message: ${err.message}` : null,
        err?.path ? `Path: ${JSON.stringify(err.path)}` : null,
        err?.extensions ? `Extensions: ${pretty(err.extensions)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");

  errorLog(`${operationName} GraphQL errors:`);
  errorLog(pretty(json.errors));

  throw new Error(
    `${operationName} GraphQL error: ${message || "Unknown GraphQL error"}`,
  );
}

function formatUserErrors(userErrors = []) {
  return userErrors
    .map((err) => {
      const field = Array.isArray(err?.field)
        ? err.field.join(".")
        : err?.field;

      return [
        field ? `Field: ${field}` : null,
        err?.code ? `Code: ${err.code}` : null,
        err?.message ? `Message: ${err.message}` : null,
        err?.extraInfo ? `ExtraInfo: ${err.extraInfo}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean);
}

function throwUserErrors(userErrors, operationName) {
  if (!userErrors?.length) {
    return;
  }

  errorLog(`${operationName} Shopify userErrors:`);

  errorLog(pretty(userErrors));

  const formatted = formatUserErrors(userErrors);

  throw new Error(
    `${operationName} failed: ${
      formatted.join("; ") || "Unknown Shopify user error"
    }`,
  );
}

/**
 * ---------------------------------------------------------
 * CONFIG PARSER
 * ---------------------------------------------------------
 */

function parseConfig(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }

    warn("Discount metafield JSON is not an object:", value);

    return null;
  } catch (err) {
    warn("Could not parse discount metafield JSON:", err?.message);

    return null;
  }
}

/**
 * ---------------------------------------------------------
 * FIND EXISTING WHOLESALE DISCOUNT
 * ---------------------------------------------------------
 *
 * Priority:
 *
 * 1. Our $app:tier_customer_tags metafield
 * 2. Exact discount title
 *
 * We DO NOT fall back to the first DiscountAutomaticApp,
 * because that could be another app's discount.
 */

async function findWholesaleDiscount(admin) {
  let after = null;
  let page = 1;

  while (true) {
    log(`Searching discount nodes - page ${page}...`);

    const response = await admin.graphql(
      `#graphql
        query GetDiscountNodes(
          $first: Int!
          $after: String
        ) {
          discountNodes(
            first: $first
            after: $after
          ) {
            edges {
              cursor

              node {
                id

                discount {
                  __typename

                  ... on DiscountAutomaticApp {
                    title
                    status
                    startsAt
                    endsAt
                    discountClasses

                    appDiscountType {
                      appKey
                      functionId
                      title
                      discountClasses
                    }
                  }
                }

                metafield(
                  namespace: "$app"
                  key: "tier_customer_tags"
                ) {
                  id
                  namespace
                  key
                  type
                  value
                }
              }
            }

            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      {
        variables: {
          first: 100,
          after,
        },
      },
    );

    const json = await response.json();

    log("GetDiscountNodes raw response:");
    log(pretty(json));

    ensureNoGraphQLErrors(json, "GetDiscountNodes");

    const connection = json?.data?.discountNodes;

    const nodes = connection?.edges?.map((edge) => edge.node) ?? [];

    log(`Found ${nodes.length} discount nodes on page ${page}.`);

    /**
     * First priority:
     * our app configuration metafield.
     */
    const metafieldMatch = nodes.find(
      (node) =>
        node?.discount?.__typename === "DiscountAutomaticApp" &&
        node?.metafield?.namespace === METAFIELD_NAMESPACE &&
        node?.metafield?.key === METAFIELD_KEY,
    );

    if (metafieldMatch) {
      log(
        "Found Wholesale B2B Pricing discount via app metafield:",
        pretty({
          id: metafieldMatch.id,
          title: metafieldMatch.discount?.title,
          status: metafieldMatch.discount?.status,
          startsAt: metafieldMatch.discount?.startsAt,
          endsAt: metafieldMatch.discount?.endsAt,
          discountClasses: metafieldMatch.discount?.discountClasses,
          appDiscountType: metafieldMatch.discount?.appDiscountType,
        }),
      );

      return metafieldMatch;
    }

    /**
     * Second priority:
     * exact title.
     */
    const titleMatch = nodes.find(
      (node) =>
        node?.discount?.__typename === "DiscountAutomaticApp" &&
        node?.discount?.title === DISCOUNT_TITLE,
    );

    if (titleMatch) {
      log(
        "Found Wholesale B2B Pricing discount via exact title:",
        pretty({
          id: titleMatch.id,
          title: titleMatch.discount?.title,
          status: titleMatch.discount?.status,
          startsAt: titleMatch.discount?.startsAt,
          endsAt: titleMatch.discount?.endsAt,
          discountClasses: titleMatch.discount?.discountClasses,
          appDiscountType: titleMatch.discount?.appDiscountType,
        }),
      );

      return titleMatch;
    }

    if (!connection?.pageInfo?.hasNextPage) {
      break;
    }

    after = connection.pageInfo.endCursor;

    page++;
  }

  log("Wholesale B2B Pricing discount was NOT found.");

  return null;
}

/**
 * ---------------------------------------------------------
 * CREATE DISCOUNT
 * ---------------------------------------------------------
 */

async function createWholesaleDiscount(admin) {
  log("Creating Wholesale B2B Pricing discount...");

  const input = {
    title: DISCOUNT_TITLE,

    /**
     * Shopify Function handle.
     */
    functionHandle: FUNCTION_HANDLE,

    /**
     * This Function is intended to modify
     * product prices.
     */
    discountClasses: ["PRODUCT"],
    context: {
      all: "ALL",
    },
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: true,
      shippingDiscounts: true,
    },

    /**
     * Start immediately.
     */
    startsAt: new Date().toISOString(),

    /**
     * No endsAt = no expiry.
     */

    metafields: [
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(DEFAULT_CONFIG),
      },
    ],
  };

  log("discountAutomaticAppCreate input:");
  log(pretty(input));

  const response = await admin.graphql(
    `#graphql
      mutation CreateWholesaleDiscount(
        $automaticAppDiscount: DiscountAutomaticAppInput!
      ) {
        discountAutomaticAppCreate(
          automaticAppDiscount: $automaticAppDiscount
        ) {
          automaticAppDiscount {
            discountId
            title
            status
            startsAt
            endsAt
            discountClasses

            appDiscountType {
              appKey
              functionId
              title
              discountClasses
            }
          }

          userErrors {
            field
            code
            message
            extraInfo
          }
        }
      }
    `,
    {
      variables: {
        automaticAppDiscount: input,
      },
    },
  );

  const json = await response.json();

  log("discountAutomaticAppCreate raw response:");
  log(pretty(json));

  ensureNoGraphQLErrors(json, "discountAutomaticAppCreate");

  const result = json?.data?.discountAutomaticAppCreate;

  throwUserErrors(result?.userErrors, "discountAutomaticAppCreate");

  const created = result?.automaticAppDiscount;

  if (!created?.discountId) {
    errorLog("Shopify did not return a discountId.");

    throw new Error(
      "Shopify did not return a discountId after creating the Wholesale B2B Pricing discount.",
    );
  }

  log("Wholesale B2B Pricing discount created successfully:", pretty(created));

  return {
    id: created.discountId,

    discount: {
      __typename: "DiscountAutomaticApp",
      title: created.title || DISCOUNT_TITLE,
      status: created.status,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      discountClasses: created.discountClasses || [],
      appDiscountType: created.appDiscountType || null,
    },

    metafield: {
      value: JSON.stringify(DEFAULT_CONFIG),
    },
  };
}

/**
 * ---------------------------------------------------------
 * ACTIVATE DISCOUNT
 * ---------------------------------------------------------
 */

async function activateWholesaleDiscount(admin, discountId) {
  log("============================================");

  log("Attempting to ACTIVATE Wholesale B2B Pricing discount");

  log("Discount ID:", discountId);

  log("Activation mutation variables:");

  log(
    pretty({
      id: discountId,
    }),
  );

  const response = await admin.graphql(
    `#graphql
      mutation ActivateDiscount($id: ID!) {
        discountAutomaticActivate(
          id: $id
        ) {
          automaticDiscountNode {
            automaticDiscount {
              ... on DiscountAutomaticApp {
                title
                status
                startsAt
                endsAt
                discountClasses

                appDiscountType {
                  appKey
                  functionId
                  title
                  discountClasses
                }
              }
            }
          }

          userErrors {
            field
            code
            message
            extraInfo
          }
        }
      }
    `,
    {
      variables: {
        id: discountId,
      },
    },
  );

  const json = await response.json();

  /**
   * THIS IS THE MOST IMPORTANT LOG.
   *
   * It shows the complete Shopify response,
   * including code + extraInfo.
   */
  errorLog("discountAutomaticActivate RAW RESPONSE:");
  errorLog(pretty(json));

  /**
   * GraphQL-level errors.
   */
  ensureNoGraphQLErrors(json, "discountAutomaticActivate");

  const result = json?.data?.discountAutomaticActivate;

  /**
   * Shopify mutation-level errors.
   */
  if (result?.userErrors?.length) {
    errorLog("============================================");

    errorLog("SHOPIFY ACTIVATION FAILED");

    errorLog("Discount ID:", discountId);

    errorLog("Shopify userErrors:");

    errorLog(pretty(result.userErrors));

    const formatted = formatUserErrors(result.userErrors);

    errorLog("Formatted activation errors:");

    errorLog(formatted.join("\n"));

    errorLog("============================================");

    throw new Error(
      `Unable to activate ${DISCOUNT_TITLE}: ${formatted.join("; ")}`,
    );
  }

  const activatedDiscount = result?.automaticDiscountNode?.automaticDiscount;

  if (!activatedDiscount) {
    errorLog("Activation returned no automaticDiscount object.");

    errorLog("Complete activation result:");

    errorLog(pretty(result));

    throw new Error(
      "Shopify did not return the automatic discount after activation.",
    );
  }

  log("Activation response discount:");

  log(pretty(activatedDiscount));

  log("============================================");

  return activatedDiscount;
}

/**
 * ---------------------------------------------------------
 * REFRESH DISCOUNT AFTER ACTIVATE
 * ---------------------------------------------------------
 *
 * We query Shopify again after activation so we know
 * the REAL final status instead of trusting the mutation.
 */

async function getDiscountById(admin, discountId) {
  log("Re-checking discount status after mutation...");

  const response = await admin.graphql(
    `#graphql
      query GetDiscountById($id: ID!) {
        discountNode(id: $id) {
          id

          discount {
            __typename

            ... on DiscountAutomaticApp {
              title
              status
              startsAt
              endsAt
              discountClasses

              appDiscountType {
                appKey
                functionId
                title
                discountClasses
              }
            }
          }

          metafield(
            namespace: "$app"
            key: "tier_customer_tags"
          ) {
            id
            namespace
            key
            type
            value
          }
        }
      }
    `,
    {
      variables: {
        id: discountId,
      },
    },
  );

  const json = await response.json();

  log("GetDiscountById raw response:");

  log(pretty(json));

  ensureNoGraphQLErrors(json, "GetDiscountById");

  const node = json?.data?.discountNode;

  if (!node) {
    throw new Error(
      `Shopify could not find discount node ${discountId} after activation.`,
    );
  }

  log("FINAL SHOPIFY DISCOUNT STATE:");

  log(
    pretty({
      id: node.id,
      discount: node.discount,
      metafield: node.metafield,
    }),
  );

  return node;
}

/**
 * ---------------------------------------------------------
 * ENSURE METAFIELD
 * ---------------------------------------------------------
 */

async function ensureDiscountMetafield(admin, discountId, existingMetafield) {
  if (existingMetafield?.value) {
    const parsed = parseConfig(existingMetafield.value);

    if (parsed) {
      log("Discount configuration metafield already exists.");

      return {
        config: parsed,
        created: false,
      };
    }

    warn(
      "Existing discount configuration metafield contains invalid JSON. Reinitializing.",
    );
  }

  log("Initializing discount configuration metafield...");

  const response = await admin.graphql(
    `#graphql
      mutation InitDiscountMetafield(
        $metafields: [MetafieldsSetInput!]!
      ) {
        metafieldsSet(
          metafields: $metafields
        ) {
          metafields {
            id
            namespace
            key
            type
            value
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
        metafields: [
          {
            ownerId: discountId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "json",
            value: JSON.stringify(DEFAULT_CONFIG),
          },
        ],
      },
    },
  );

  const json = await response.json();

  log("metafieldsSet raw response:");

  log(pretty(json));

  ensureNoGraphQLErrors(json, "metafieldsSet");

  const result = json?.data?.metafieldsSet;

  if (result?.userErrors?.length) {
    errorLog("Discount metafield initialization failed:");

    errorLog(pretty(result.userErrors));

    throw new Error(
      `Unable to initialize discount metafield: ${result.userErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }

  log("Discount configuration metafield initialized.");

  return {
    config: DEFAULT_CONFIG,
    created: true,
  };
}

/**
 * ---------------------------------------------------------
 * MAIN
 * ---------------------------------------------------------
 */

export async function ensureActiveDiscount(admin) {
  log("============================================");

  log("START ensureActiveDiscount()");

  log("Function handle:", FUNCTION_HANDLE);

  log("Discount title:", DISCOUNT_TITLE);

  log("============================================");

  try {
    let targetNode = await findWholesaleDiscount(admin);

    let autoCreated = false;
    let autoActivated = false;

    /**
     * -----------------------------------------------------
     * 1. CREATE IF MISSING
     * -----------------------------------------------------
     */

    if (!targetNode) {
      log("No existing Wholesale discount found.");

      targetNode = await createWholesaleDiscount(admin);

      autoCreated = true;

      log("Discount was automatically created.");
    } else {
      log("Existing Wholesale discount found.");
    }

    /**
     * -----------------------------------------------------
     * LOG CURRENT STATE
     * -----------------------------------------------------
     */

    log("CURRENT DISCOUNT STATE:");

    log(
      pretty({
        id: targetNode?.id,
        title: targetNode?.discount?.title,
        status: targetNode?.discount?.status,
        startsAt: targetNode?.discount?.startsAt,
        endsAt: targetNode?.discount?.endsAt,
        discountClasses: targetNode?.discount?.discountClasses,
        appDiscountType: targetNode?.discount?.appDiscountType,
      }),
    );

    /**
     * -----------------------------------------------------
     * 2. ACTIVATE IF NOT ACTIVE
     * -----------------------------------------------------
     */

    const currentStatus = targetNode?.discount?.status;

    log("Current discount status:", currentStatus);

    if (!targetNode?.id) {
      throw new Error(
        "Wholesale B2B Pricing discount was found but has no ID.",
      );
    }

    if (currentStatus !== "ACTIVE") {
      log(`Discount is ${currentStatus}. Activation is required.`);

      await activateWholesaleDiscount(admin, targetNode.id);

      autoActivated = true;

      /**
       * Re-fetch from Shopify and use the actual
       * final state.
       */
      targetNode = await getDiscountById(admin, targetNode.id);

      log("Discount state after activation:");

      log(
        pretty({
          id: targetNode.id,
          title: targetNode.discount?.title,
          status: targetNode.discount?.status,
          startsAt: targetNode.discount?.startsAt,
          endsAt: targetNode.discount?.endsAt,
          discountClasses: targetNode.discount?.discountClasses,
          appDiscountType: targetNode.discount?.appDiscountType,
        }),
      );
    } else {
      log("Discount is already ACTIVE. No activation needed.");
    }

    /**
     * -----------------------------------------------------
     * 3. ENSURE METAFIELD
     * -----------------------------------------------------
     */

    let config = parseConfig(targetNode?.metafield?.value);

    if (!config) {
      log("Discount configuration metafield is missing or invalid.");

      const metafieldResult = await ensureDiscountMetafield(
        admin,
        targetNode.id,
        targetNode.metafield,
      );

      config = metafieldResult.config;

      targetNode.metafield = {
        value: JSON.stringify(config),
      };
    } else {
      log("Discount configuration loaded successfully.");
    }

    /**
     * -----------------------------------------------------
     * 4. FINAL STATUS
     * -----------------------------------------------------
     */

    const finalStatus = targetNode?.discount?.status || "UNKNOWN";

    const isActive = finalStatus === "ACTIVE";

    log("============================================");

    log("FINAL ensureActiveDiscount RESULT:");

    log(
      pretty({
        discountId: targetNode?.id ?? null,

        title: targetNode?.discount?.title || DISCOUNT_TITLE,

        status: finalStatus,

        isActive,

        autoCreated,

        autoActivated,
      }),
    );

    log("============================================");

    return {
      discountId: targetNode?.id ?? null,

      title: targetNode?.discount?.title || DISCOUNT_TITLE,

      status: finalStatus,

      isActive,

      autoCreated,

      autoActivated,

      config: config ?? DEFAULT_CONFIG,
    };
  } catch (error) {
    /**
     * -----------------------------------------------------
     * GLOBAL ERROR
     * -----------------------------------------------------
     */

    errorLog("============================================");

    errorLog("ensureActiveDiscount() FAILED");

    errorLog("Error message:", error?.message);

    errorLog("Error stack:", error?.stack);

    errorLog("Full error object:", error);

    errorLog("============================================");

    return {
      discountId: null,

      title: DISCOUNT_TITLE,

      status: "UNKNOWN",

      isActive: false,

      autoCreated: false,

      autoActivated: false,

      config: {},

      error: error?.message || "Unknown error while ensuring discount.",
    };
  }
}
