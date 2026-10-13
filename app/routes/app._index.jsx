import { authenticate } from "../shopify.server";
import { useLoaderData, useNavigate } from "react-router";
import { ensureActiveDiscount } from "../discount.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Ensure Wholesale B2B Discount function is created, active, and initialized
  const discountInfo = await ensureActiveDiscount(admin);

  // 2. Discover all pricing tier metafield definitions on ProductVariant
  const tiersResponse = await admin.graphql(
    `#graphql
      query MetafieldDefinitions {
        metafieldDefinitions(
          first: 100
          namespace: "$app"
          ownerType: PRODUCTVARIANT
        ) {
          nodes {
            id
            key
            name
            type {
              name
            }
          }
        }
      }
    `
  );

  const getTiers = await tiersResponse.json();
  const definitionNodes = getTiers?.data?.metafieldDefinitions?.nodes ?? [];

  // Map definitions by key
  const defMap = {};
  for (const def of definitionNodes) {
    defMap[def.key] = def;
  }

  // Tiers mapping from discount config
  const savedTierConfig =
    discountInfo.config?.tiers ?? discountInfo.config ?? {};

  // Automatically discover and sync tiers:
  // - Any key ending with "_pricing" is a price definition
  // - Companion quantity definition is "${priceKey}_min"
  const tiers = Object.keys(defMap)
    .filter((key) => key.endsWith("_pricing"))
    .map((priceKey) => {
      const priceDef = defMap[priceKey];
      const qtyKey = `${priceKey}_min`;
      const qtyDef = defMap[qtyKey] ?? null;

      // Extract numeric ID only from the GID (e.g. "gid://shopify/MetafieldDefinition/12345" -> "12345")
      const numericId = priceDef.id ? priceDef.id.split("/").pop() : "";
      const configuredTags = savedTierConfig[priceKey] ?? [];

      return {
        id: priceDef.id,
        numericId,
        name: priceDef.name,
        priceKey,
        priceType: priceDef.type?.name ?? "money",
        qtyKey: qtyDef ? qtyKey : null,
        qtyId: qtyDef?.id ?? null,
        qtyNumericId: qtyDef?.id ? qtyDef.id.split("/").pop() : null,
        qtyName: qtyDef?.name ?? null,
        configuredTags,
      };
    });

  return { tiers, discountInfo };
};

export default function PricingTiersHome() {
  const { tiers = [], discountInfo } = useLoaderData();
  const navigate = useNavigate();

  return (
    <s-page heading="Wholesale Pricing Tiers">
      {/* ── Automatic Discount Function Status ─────────────────────────── */}
      <s-section>
        {discountInfo.isActive ? (
          <s-banner tone="success">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">
                Wholesale B2B Discount Function is Active & Running
              </s-text>
              <s-text>
                Automatic discounts are enabled at checkout. Eligible customers
                matching configured tier tags will receive wholesale prices.
              </s-text>
              {discountInfo.autoCreated && (
                <s-text tone="subdued">
                  (Automatically created and activated on first app install)
                </s-text>
              )}
              {discountInfo.autoActivated && !discountInfo.autoCreated && (
                <s-text tone="subdued">
                  (Automatically re-activated on app open)
                </s-text>
              )}
            </s-stack>
          </s-banner>
        ) : (
          <s-banner tone="warning">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">
                Wholesale Discount Status: {discountInfo.status || "Inactive"}
              </s-text>
              <s-text>
                {discountInfo.error
                  ? `Activation error: ${discountInfo.error}`
                  : "Checking discount function activation status..."}
              </s-text>
            </s-stack>
          </s-banner>
        )}
      </s-section>

      {/* ── Pricing Tiers Grid ─────────────────────────────────────────── */}
      <s-section heading="Select a Pricing Tier to Configure">
        {tiers.length === 0 ? (
          <s-banner tone="info">
            No wholesale pricing tiers found. Add variant metafield definitions in your app configuration.
          </s-banner>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap="base">
            {tiers.map((tier) => (
              <s-clickable
                key={tier.numericId || tier.priceKey}
                href={`/app/pricing?id=${tier.numericId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/app/pricing?id=${tier.numericId}`);
                }}
                padding="base"
                borderRadius="base"
                border="base"
              >
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-text type="strong">{tier.name}</s-text>
                    <s-badge tone={tier.configuredTags.length > 0 ? "info" : "neutral"}>
                      {tier.configuredTags.length > 0
                        ? `${tier.configuredTags.length} tags`
                        : "No tags"}
                    </s-badge>
                  </s-stack>

                  <s-text tone="subdued">Pricing Key: {tier.priceKey}</s-text>

                  {tier.qtyKey && (
                    <s-text tone="subdued">
                      Min Quantity: {tier.qtyName || tier.qtyKey}
                    </s-text>
                  )}

                  {tier.configuredTags.length > 0 ? (
                    <s-stack direction="inline" gap="small-200" wrap alignItems="center">
                      <s-text type="strong" tone="subdued">Tags:</s-text>
                      {tier.configuredTags.slice(0, 3).map((t) => (
                        <s-badge key={t} tone="info">{t}</s-badge>
                      ))}
                      {tier.configuredTags.length > 3 && (
                        <s-text tone="subdued">+{tier.configuredTags.length - 3} more</s-text>
                      )}
                    </s-stack>
                  ) : (
                    <s-text tone="subdued">Click to assign customer tags & set prices</s-text>
                  )}

                  <s-stack direction="inline" justifyContent="end" paddingBlockStart="small">
                    <s-button variant="tertiary">Configure Tier →</s-button>
                  </s-stack>
                </s-stack>
              </s-clickable>
            ))}
          </s-grid>
        )}
      </s-section>
    </s-page>
  );
}
