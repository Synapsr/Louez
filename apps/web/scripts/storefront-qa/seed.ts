import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { count } from "drizzle-orm";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import * as schema from "@louez/db/schema";
import { env } from "@louez/db/env";
import { buildCombinationKey } from "@louez/utils";
import type { StoreSettings } from "@louez/types";
import { qaCases, qaStores } from "./scenarios";
import { renderReport } from "./report";

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Run pnpm qa:storefront setup");
  const state = JSON.parse(readFileSync(path.join(output, "state.json"), "utf8"));
  const url = new URL(env.DATABASE_URL);
  if (
    state.kind !== "louez-storefront-qa-v1" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== String(state.dbPort) ||
    url.pathname !== "/louez_storefront_qa" ||
    url.username !== "storefront_qa" ||
    url.password !== state.dbPassword
  ) {
    throw new Error("Refusing to seed a database outside the isolated QA environment");
  }
  const connection = await mysql.createConnection(env.DATABASE_URL);
  const db = drizzle(connection, { schema, mode: "default" });
  const id = (key: string) =>
    createHash("sha256").update(`storefront-qa-v1:${key}`).digest("hex").slice(0, 21);
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(10, 0, 0, 0);
    return d;
  };
  const start = day(7);
  const end = day(9);
  const publicDir = path.resolve("public/qa");
  mkdirSync(publicDir, { recursive: true });
  const base = "https://louez-qa.localify";
  const links: Record<string, string> = {};
  const tulipProducts: Record<string, unknown>[] = [];
  const productNames = [
    "Vélo ville",
    "Casque",
    "Antivol",
    "Vélo cargo",
    "Remorque",
    "Vélo tailles M et L",
    "Vélo épuisé",
    "Kit réparation consommable",
    "Service sans stock",
    "Brouillon invisible",
    "Archive invisible",
    "Vélo électrique",
  ];

  try {
    const [existing] = await db.select({ total: count() }).from(schema.stores);
    if (existing.total > 0) {
      console.log(
        "Existing QA stores preserved. Use pnpm qa:storefront reset to restore fixtures.",
      );
    } else {
      await db.transaction(async (tx) => {
        await tx.insert(schema.users).values({
          id: id("owner"),
          name: "Équipe recette",
          email: "owner@example.test",
          emailVerified: true,
        });
        for (const store of qaStores) {
          const storeId = id(store.slug);
          const settings: StoreSettings = {
            reservationMode: store.payment ? "payment" : "request",
            advanceNoticeMinutes: 0,
            minRentalMinutes: 60,
            maxRentalMinutes: null,
            country: "FR",
            currency: "EUR",
            timezone: "Europe/Paris",
            pendingBlocksAvailability: true,
            requireCustomerAddress: false,
            ...store.settings,
          };
          if (store.slug === "contraintes") {
            const open = {
              isOpen: true,
              ranges: [
                { openTime: "09:00", closeTime: "12:00" },
                { openTime: "14:00", closeTime: "18:00" },
              ],
            };
            settings.businessHours = {
              enabled: true,
              schedule: {
                0: { isOpen: false, ranges: [] },
                1: open,
                2: open,
                3: open,
                4: open,
                5: open,
                6: open,
              },
              closurePeriods: [
                {
                  id: "qa-closure",
                  name: "Fermeture recette",
                  startDate: day(14).toISOString().slice(0, 10),
                  endDate: day(16).toISOString().slice(0, 10),
                },
              ],
            };
          }
          await tx.insert(schema.stores).values({
            id: storeId,
            userId: id("owner"),
            slug: store.slug,
            name: `QA · ${store.name}`,
            settings,
            description:
              store.slug === "minimal" || store.slug === "vide"
                ? null
                : "<p>Boutique fictive pour la recette du storefront.</p>",
            email: "owner@example.test",
            address: store.slug === "minimal" ? null : "Place de la République, Paris",
            latitude: store.slug === "minimal" ? null : "48.8674000",
            longitude: store.slug === "minimal" ? null : "2.3639000",
            theme: {
              mode: "light",
              primaryColor: "#2563eb",
              ...(["catalogue", "demande"].includes(store.slug)
                ? {
                    heroImages: [
                      "/images/ai-image-examples/enhance-example-1-after.webp",
                      "/images/ai-image-examples/enhance-example-2-after.webp",
                    ],
                  }
                : {}),
              ...store.theme,
            },
            cgv:
              store.slug === "minimal"
                ? null
                : "<p>Conditions fictives de recette. Aucune location réelle.</p>",
            legalNotice:
              store.slug === "minimal" ? null : "<p>Environnement local de test Louez.</p>",
            onboardingCompleted: true,
            stripeAccountId: store.payment ? `acct_qa_${store.slug}` : null,
            stripeChargesEnabled: Boolean(store.payment),
            stripeOnboardingComplete: Boolean(store.payment),
          });
          await tx.insert(schema.storeMembers).values({
            id: id(`${store.slug}:member`),
            storeId,
            userId: id("owner"),
            role: "owner",
          });
          await tx.insert(schema.subscriptions).values({
            id: id(`${store.slug}:sub`),
            storeId,
            planSlug: "ultra",
            billingMode: "subscription",
            status: "active",
          });
          if (store.insurance) {
            const integrationId = id(`${store.slug}:tulip`);
            await tx.insert(schema.storeIntegrations).values({
              id: integrationId,
              storeId,
              providerKey: "tulip",
              category: "insurance",
              enabled: true,
              status: "active",
            });
            await tx.insert(schema.storeTulipIntegrations).values({
              id: id(`${store.slug}:tulip-state`),
              integrationId,
              renterUid: `qa-${store.slug}`,
              publicMode: store.insurance,
              connectedAt: now,
            });
          }
          if (settings.delivery?.multiLocationEnabled) {
            await tx.insert(schema.storeLocations).values({
              id: id(`${store.slug}:annexe`),
              storeId,
              name: "Annexe Bastille",
              address: "Place de la Bastille",
              city: "Paris",
              postalCode: "75011",
              latitude: "48.8530000",
              longitude: "2.3690000",
            });
          }
          if (store.count > 1) {
            for (let n = 0; n < 4; n++)
              await tx.insert(schema.categories).values({
                id: id(`${store.slug}:cat:${n}`),
                storeId,
                name: ["Vélos", "Accessoires", "Équipement", "Catégorie vide"][n],
                order: n,
              });
          }
          for (let n = 0; n < store.count; n++) {
            const productId = id(`${store.slug}:product:${n}`);
            const isComplex = store.slug === "produits";
            const isPricing = store.slug === "tarifs";
            const name = isPricing
              ? [
                  "Vélo jour 25 € HT",
                  "Casque heure 5 € HT",
                  "Antivol semaine 15 € HT",
                  "Forfait 40 € HT",
                  "Forfaits stricts",
                  "Haute saison",
                  ...productNames.slice(6),
                ][n]
              : productNames[n % productNames.length] +
                (n >= productNames.length ? ` ${n + 1}` : "");
            const price = isPricing
              ? ([25, 5, 15, 40, 25, 25][n] ?? 25)
              : ([25, 5, 3, 45, 15][n] ?? 25);
            const period = isPricing && n === 1 ? 60 : isPricing && n === 2 ? 10080 : 1440;
            await tx.insert(schema.products).values({
              id: productId,
              storeId,
              name,
              description:
                store.slug === "minimal"
                  ? null
                  : "<p>Matériel fictif. Choisissez votre période pour tester la réservation.</p>",
              price: String(price),
              deposit: n === 0 ? "100" : "0",
              pricingMode: period === 60 ? "hour" : period === 10080 ? "week" : "day",
              basePeriodMinutes: period,
              pricingKind:
                (isPricing && n === 3) || (isComplex && [7, 8].includes(n)) ? "fixed" : "duration",
              stockKind:
                isComplex && n === 7
                  ? "consumable"
                  : isComplex && n === 8
                    ? "untracked"
                    : "returnable",
              quantity: isComplex && n === 6 ? 0 : isComplex && n === 5 ? 2 : 10,
              trackUnits: isComplex && n === 5,
              bookingAttributeAxes:
                isComplex && n === 5 ? [{ key: "size", label: "Taille", position: 0 }] : null,
              status:
                isComplex && n === 9 ? "draft" : isComplex && n === 10 ? "archived" : "active",
              enforceStrictTiers: isPricing && n === 4,
              categoryId: store.count > 1 ? id(`${store.slug}:cat:${n % 3}`) : null,
              images:
                store.slug === "minimal" || n % 2 !== 0
                  ? []
                  : [
                      "/images/ai-image-examples/enhance-example-1-after.webp",
                      "/images/ai-image-examples/enhance-example-2-after.webp",
                    ],
              displayOrder: n,
            });
            if (store.count > 1)
              await tx.insert(schema.productCategories).values({
                id: id(`${store.slug}:pc:${n}`),
                productId,
                categoryId: id(`${store.slug}:cat:${n % 3}`),
              });
            if (isComplex && n === 5) {
              for (const size of ["M", "L", "XL"])
                await tx.insert(schema.productUnits).values({
                  id: id(`${store.slug}:unit:${size}`),
                  productId,
                  identifier: `QA-${size}`,
                  attributes: { size },
                  combinationKey: buildCombinationKey(
                    [{ key: "size", label: "Taille", position: 0 }],
                    { size },
                  ),
                  lifecycleStatus: size === "XL" ? "retired" : "active",
                });
            }
            if (isPricing && n === 4)
              for (const [duration, amount] of [
                [1440, 25],
                [4320, 60],
                [10080, 110],
              ]) {
                await tx.insert(schema.productPricingTiers).values({
                  id: id(`${store.slug}:tier:${duration}`),
                  productId,
                  period: duration,
                  minDuration: duration,
                  price: String(amount),
                });
              }
            if (isPricing && n === 5)
              await tx.insert(schema.productSeasonalPricing).values({
                id: id(`${store.slug}:season`),
                productId,
                name: "Haute saison recette",
                startDate: day(14).toISOString().slice(0, 10),
                endDate: day(28).toISOString().slice(0, 10),
                price: "40",
              });
            if (
              store.insurance &&
              (store.coverage === "all" || (store.coverage === "mixed" && n % 2 === 0))
            ) {
              const tulipId = `qa-${productId}`;
              await tx.insert(schema.productsTulip).values({
                id: id(`${store.slug}:mapping:${n}`),
                productId,
                tulipProductId: tulipId,
              });
              tulipProducts.push({
                product_id: tulipId,
                renter_uid: `qa-${store.slug}`,
                title: name,
                product_type: "bike",
                value_excl: 500,
                data: { louez_product_ID: productId, margin: 0 },
              });
            }
            links[`${store.slug}:product:${n}`] =
              `https://${store.slug}.louez-qa.localify/product/${productId}`;
          }
          if (store.slug === "produits")
            for (const [n, required] of [
              [1, true],
              [2, false],
            ] as const) {
              await tx.insert(schema.productAccessories).values({
                id: id(`accessory:${n}`),
                productId: id("produits:product:0"),
                accessoryId: id(`produits:product:${n}`),
                required,
                quantity: 1,
              });
            }
          if (store.slug === "tarifs")
            for (const code of ["QA10", "QA5", "EXPIRE", "EPUISE", "MIN100"]) {
              await tx.insert(schema.promoCodes).values({
                id: id(`promo:${code}`),
                storeId,
                code,
                type: code === "QA5" ? "fixed" : "percentage",
                value: code === "QA5" ? "5" : "10",
                minimumAmount: code === "MIN100" ? "100" : null,
                expiresAt: code === "EXPIRE" ? day(-1) : null,
                maxUsageCount: code === "EPUISE" ? 1 : null,
                currentUsageCount: code === "EPUISE" ? 1 : 0,
              });
            }
          const customerId = id(`${store.slug}:customer`);
          await tx.insert(schema.customers).values({
            id: customerId,
            storeId,
            email: "client@example.test",
            firstName: "Camille",
            lastName: "Recette",
            address: "10 rue de la Paix",
            city: "Paris",
            postalCode: "75002",
            country: "FR",
          });
          if (store.slug === "suivi") {
            const statuses = schema.reservations.status.enumValues;
            const depositStatuses = schema.reservations.depositStatus.enumValues;
            for (const [index, key] of [
              ...statuses.map((status) => `reservation:${status}`),
              ...depositStatuses.map((status) => `deposit:${status}`),
            ].entries()) {
              const resId = id(`suivi:${key}`);
              const status = key.startsWith("reservation:")
                ? (statuses.find((s) => key === `reservation:${s}`) ?? "pending")
                : "confirmed";
              const depositStatus = key.startsWith("deposit:")
                ? (depositStatuses.find((s) => key === `deposit:${s}`) ?? "none")
                : "none";
              const token = randomBytes(32).toString("hex");
              const resStart =
                status === "completed"
                  ? day(-9)
                  : status === "ongoing"
                    ? day(-1)
                    : day(7 + index * 3);
              const resEnd =
                status === "completed"
                  ? day(-7)
                  : status === "ongoing"
                    ? day(1)
                    : day(9 + index * 3);
              await tx.insert(schema.reservations).values({
                id: resId,
                storeId,
                customerId,
                number: `QA-${String(index + 1).padStart(4, "0")}`,
                status,
                startDate: resStart,
                endDate: resEnd,
                subtotalAmount: "50",
                totalAmount: "50",
                depositAmount: depositStatus === "none" ? "0" : "100",
                depositStatus,
                signedAt: ["confirmed", "ongoing", "completed"].includes(status) ? now : null,
                pickedUpAt: ["ongoing", "completed"].includes(status) ? resStart : null,
                returnedAt: status === "completed" ? resEnd : null,
              });
              await tx.insert(schema.reservationItems).values({
                id: id(`item:${key}`),
                reservationId: resId,
                productId: id("suivi:product:0"),
                quantity: 1,
                unitPrice: "25",
                depositPerUnit: "0",
                totalPrice: "50",
                productSnapshot: { name: "Vélo ville", description: "", images: [] },
              });
              await tx.insert(schema.reservationActivity).values({
                id: id(`activity:${key}`),
                reservationId: resId,
                activityType: "created",
                description: "Réservation fictive préparée pour la recette.",
              });
              if (["confirmed", "ongoing", "completed"].includes(status))
                await tx.insert(schema.payments).values({
                  id: id(`payment:${key}`),
                  reservationId: resId,
                  amount: "50",
                  type: "rental",
                  method: "cash",
                  status: "completed",
                });
              await tx.insert(schema.verificationCodes).values({
                id: id(`access:${key}`),
                storeId,
                email: "client@example.test",
                code: "",
                type: "instant_access",
                token,
                reservationId: resId,
                expiresAt: day(90),
              });
              links[`suivi:${key}`] = `https://suivi.louez-qa.localify/r/${resId}?token=${token}`;
            }
          }
          if (["demande", "disponibilite"].includes(store.slug)) {
            await tx.insert(schema.reservations).values({
              id: id(`${store.slug}:pending`),
              storeId,
              customerId,
              number: "QA-STOCK",
              status: "pending",
              startDate: start,
              endDate: end,
              subtotalAmount: "500",
              totalAmount: "500",
              depositAmount: "1000",
            });
            await tx.insert(schema.reservationItems).values({
              id: id(`${store.slug}:pending-item`),
              reservationId: id(`${store.slug}:pending`),
              productId: id(`${store.slug}:product:0`),
              quantity: 10,
              unitPrice: "25",
              depositPerUnit: "100",
              totalPrice: "500",
              productSnapshot: { name: "Vélo ville", description: "", images: [] },
            });
          }
        }
      });
      const report = {
        createdAt: now.toISOString(),
        snapshotAt: state.snapshotAt,
        revision: state.revision,
        dirtyFiles: state.dirtyFiles,
        dates: {
          start: start.toISOString(),
          end: end.toISOString(),
          season: day(14).toISOString().slice(0, 10),
          seasonEnd: day(28).toISOString().slice(0, 10),
          closureEnd: day(16).toISOString().slice(0, 10),
        },
        mailUrl: `http://127.0.0.1:${state.mailPort}`,
        fixtureUrl: `http://127.0.0.1:${state.fixturePort}`,
        stores: qaStores.map((store) => ({
          ...store,
          url: `https://${store.slug}.louez-qa.localify`,
        })),
        cases: qaCases.map((item) => ({
          ...item,
          url:
            links[`${item.store}:${item.path}`] ??
            `https://${item.store}.louez-qa.localify${item.path}`,
        })),
        tulipProducts,
      };
      writeFileSync(path.join(output, "manifest.json"), JSON.stringify(report, null, 2));
      writeFileSync(path.join(publicDir, "index.html"), renderReport(report));
      writeFileSync(path.join(output, "report.html"), renderReport(report));
      writeFileSync(
        path.join(publicDir, "reset.html"),
        '<!doctype html><meta charset="utf-8"><title>Panier réinitialisé</title><script>localStorage.clear();sessionStorage.clear();location.replace("/")</script>',
      );
      console.log(
        `${qaStores.length} stores, ${report.cases.length} scenarios. ${base}/qa/index.html`,
      );
    }
    const s3 = new S3Client({
      endpoint: `http://127.0.0.1:${state.storagePort}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "storefront-qa", secretAccessKey: state.storagePassword },
    });
    try {
      await s3.send(new CreateBucketCommand({ Bucket: "storefront-qa" }));
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)
      )
        throw error;
    }
    s3.destroy();
  } finally {
    await connection.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
