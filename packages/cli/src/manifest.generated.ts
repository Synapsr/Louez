// Generated from the Louez API's OpenAPI document by scripts/generate-manifest.ts.
// Do not edit: after changing the API, run `pnpm --filter ./packages/cli generate`.
import type { Manifest } from "./manifest.js";

export const manifest: Manifest = {
  "apiVersion": "1.0.0-beta",
  "groups": [
    {
      "name": "reservations",
      "title": "Reservations",
      "description": "Rental requests, quotes and bookings, from the request to the return: list and read them, follow the calendar, the planning and what is due or late, change their status, cancel them and keep notes on them."
    },
    {
      "name": "payments",
      "title": "Payments",
      "description": "The payments, deposit returns and refunds given by hand recorded on a reservation: record one, or delete one recorded by mistake."
    },
    {
      "name": "inbox",
      "title": "Inbox",
      "description": "What needs the store's attention, such as booking requests to answer, late returns, failed payments or messages that did not go out: read what is new since a cursor, and mark items handled."
    },
    {
      "name": "products",
      "title": "Products",
      "description": "What the store rents: its products, their prices, photos and status, their order, and what happened to each."
    },
    {
      "name": "units",
      "title": "Units",
      "description": "The tracked items of a product, each with its own identifier: their details and history, downtime for repair or maintenance, and retiring a unit for good."
    },
    {
      "name": "seasonal-pricing",
      "title": "Seasonal pricing",
      "description": "Prices that replace a product's own rates on the days of a season."
    },
    {
      "name": "variants",
      "title": "Variants",
      "description": "The options products come in, such as size or colour, shared by the store's products, and their values."
    },
    {
      "name": "categories",
      "title": "Categories",
      "description": "How the store groups its products, with their images and their order."
    },
    {
      "name": "search",
      "title": "Search",
      "description": "One search across the store's products, reservations and customers, as the dashboard's search bar does."
    },
    {
      "name": "statistics",
      "title": "Statistics",
      "description": "The store's figures: its dashboard's, its revenue over a period, and how each product performs."
    },
    {
      "name": "partners",
      "title": "Partners",
      "description": "The store's local partners, such as campsites and hotels that send customers through their own link, and their monthly statements: what each booking earns them and what the store owes."
    },
    {
      "name": "online-store",
      "title": "Online store",
      "description": "The store's public site: its address, its appearance and its images."
    },
    {
      "name": "settings",
      "title": "Settings",
      "description": "How the store runs: its information, company and legal details, legal texts, reservation rules, business hours, delivery, pickup points and taxes."
    },
    {
      "name": "stores",
      "title": "Stores",
      "description": "The stores within reach, a new one, and the launch of a store: what it still lacks before customers can book, and putting it online."
    },
    {
      "name": "stripe",
      "title": "Stripe",
      "description": "The store's Stripe account, through which customers pay online: connect it, open its Stripe dashboard and refresh its status."
    },
    {
      "name": "billing",
      "title": "Billing",
      "description": "What Louez bills the store, and the card Louez bills."
    },
    {
      "name": "team",
      "title": "Team",
      "description": "The people who work in the store, and the invitations to join it."
    },
    {
      "name": "account",
      "title": "Account",
      "description": "The Louez account the API key acts for."
    },
    {
      "name": "jobs",
      "title": "Jobs",
      "description": "Work Louez runs in the background, such as an AI photo enhancement: where it stands, and its result."
    },
    {
      "name": "handoffs",
      "title": "Handoffs",
      "description": "Steps only a person can take in their browser, such as Stripe's identity checks, adding a billing card, or approving a write that needs the approval of the key's owner: the operation that starts one returns a link, and these say where the step stands."
    }
  ],
  "operations": [
    {
      "id": "categories_list",
      "group": "categories",
      "action": "list",
      "method": "GET",
      "path": "/categories",
      "summary": "List Categories",
      "description": "Lists the store's product categories in the store's order (as `POST /categories/reorder` sets it, then by name), each with its position and the number of products it holds. Returns up to `limit` categories (500 by default and at most) in `items`. To read on, pass `nextCursor` back as `cursor`; it is null on the last page, and a cursor this operation did not return answers `INVALID_CURSOR`. Each category comes with `links.dashboard`, the dashboard's categories page, and `links.storefront` once the store is online.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Categories per page, 500 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "categories_create",
      "group": "categories",
      "action": "create",
      "method": "POST",
      "path": "/categories",
      "summary": "Create Category",
      "description": "Creates a product category, placed last in the store's order. `name` takes 2 to 255 characters; `description` and `imageUrl` are optional. When the store already has a category of the same name, whatever the case, that one is returned unchanged with `created: false`, so a retry creates nothing twice. A store holds 2,000 categories at most: past that, `CATEGORY_LIMIT_REACHED`. `imageUrl` takes the `url` of a category image uploaded for the store (`POST /categories/images`, or `POST /categories/image-uploads` then `POST /categories/image-uploads/complete`); another URL is refused with `CATEGORY_IMAGE_INVALID`. Its `links.dashboard` is the dashboard's categories page; once the store is online, `links.storefront` is the storefront catalog filtered on the category.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "required": true
          },
          {
            "name": "description",
            "flag": "description",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "nullable": true,
            "description": "Public URL of an image stored for this store, as categories_upload_image or categories_complete_image_upload returns it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "categories_get",
      "group": "categories",
      "action": "get",
      "method": "GET",
      "path": "/categories/{id}",
      "summary": "Get Category",
      "description": "Returns one category of the store: its name, slug, description, image, position and number of products. An id the store does not have answers `CATEGORY_NOT_FOUND`. Its `links.dashboard` is the dashboard's categories page; once the store is online, `links.storefront` is the storefront catalog filtered on the category.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "categories_update",
      "group": "categories",
      "action": "update",
      "method": "PATCH",
      "path": "/categories/{id}",
      "summary": "Update Category",
      "description": "Changes a category's name, description or image. Send only the fields to change: a field left out stays as it is, and null clears the description or the image. A name another category of the store already has, whatever the case, is refused with `CATEGORY_NAME_TAKEN`; an id the store does not have answers `CATEGORY_NOT_FOUND`. `imageUrl` takes the `url` of a category image uploaded for the store (`POST /categories/images`, or `POST /categories/image-uploads` then `POST /categories/image-uploads/complete`); another URL is refused with `CATEGORY_IMAGE_INVALID`. Returns the category. Its `links.dashboard` is the dashboard's categories page; once the store is online, `links.storefront` is the storefront catalog filtered on the category.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string"
          },
          {
            "name": "description",
            "flag": "description",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "nullable": true,
            "description": "Public URL of an image stored for this store, as categories_upload_image or categories_complete_image_upload returns it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "categories_delete",
      "group": "categories",
      "action": "delete",
      "method": "DELETE",
      "path": "/categories/{id}",
      "summary": "Delete Category",
      "description": "Deletes a category. Its products keep their other categories, or move to `replacementCategoryId` when given; a product whose main category it was takes its next one, or none. A replacement that is not another category of the store answers `CATEGORY_REPLACEMENT_INVALID`. On a key that asks for confirmations, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), with a preview of the products that lose the category and of those left with none. Returns the deleted id, the number of products it held and the replacement's id.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "replacementCategoryId",
            "flag": "replacement-category-id",
            "kind": "string",
            "nullable": true,
            "description": "Optional. Another category of the store that takes over the deleted one's products."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "categories_reorder",
      "group": "categories",
      "action": "reorder",
      "method": "POST",
      "path": "/categories/reorder",
      "summary": "Reorder Categories",
      "description": "Sets the order of the store's categories, as the storefront shows them. `ids` holds every category of the store, each once, in the new order (`GET /categories` gives them). A list with a category missing, unknown or repeated is refused with `CATEGORY_ORDER_MISMATCH`, which names them in `details.missing`, `details.unknown` and `details.duplicates`. Returns each id with its new position, from 1.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "ids",
            "flag": "ids",
            "kind": "string",
            "list": true,
            "required": true,
            "description": "Every category of the store, each once, in the new order."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "categories_create_image_upload",
      "group": "categories",
      "action": "create-image-upload",
      "method": "POST",
      "path": "/categories/image-uploads",
      "summary": "Start Category Image Upload",
      "description": "Starts the upload of a category image: JPEG, PNG, GIF or WebP, 5 MB at most (`UPLOAD_TOO_LARGE` above). Send its `contentType` and `size` in bytes. The upload takes three requests:\n\n1. This one returns a `key`, an `upload` and its `expiresAt`, 10 minutes from now.\n2. Send the file's bytes in the one request `upload` describes, without the `Authorization` header and before `expiresAt`: with `upload.method` PUT, the bytes as the body of a PUT to `upload.url` with `upload.headers`, its `Content-Type` included; with POST, a `multipart/form-data` POST to `upload.url` with `upload.fields` first, then the file as `file`.\n3. `POST /categories/image-uploads/complete` with the `key` checks the file and returns its public `url`.\n\nEach call issues a new upload. `POST /categories/images` uploads an image in one request instead.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "required": true,
            "description": "The image's type. Send the bytes with exactly this Content-Type."
          },
          {
            "name": "size",
            "flag": "size",
            "kind": "integer",
            "required": true,
            "description": "The file's size in bytes."
          }
        ]
      },
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "categories_complete_image_upload",
      "group": "categories",
      "action": "complete-image-upload",
      "method": "POST",
      "path": "/categories/image-uploads/complete",
      "summary": "Complete Category Image Upload",
      "description": "Finishes a category image upload started with `POST /categories/image-uploads`, once its file was sent: checks the file at the `key` (its size, and that its bytes are an image of the declared type), makes it publicly readable and returns its `url`, its type and its size. `imageUrl` takes that `url` in `POST /categories` and `PATCH /categories/{id}`. It changes no category. A key that is not a category upload of the store answers `UPLOAD_NOT_OWNED`; a key with no file sent yet, `UPLOAD_NOT_FOUND`. A file over 5 MB (`UPLOAD_TOO_LARGE`) or whose bytes are not an image of the declared type (`UPLOAD_CONTENT_INVALID`) is refused and stays private: start over with a new upload. Completing the same key again returns the same answer.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "key",
            "flag": "key",
            "kind": "string",
            "required": true,
            "description": "The key the create-upload call returned."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "categories_upload_image",
      "group": "categories",
      "action": "upload-image",
      "method": "POST",
      "path": "/categories/images",
      "summary": "Upload Category Image",
      "description": "Uploads a category image in one request: JPEG, PNG, GIF or WebP, 5 MB at most. Send exactly one of `contentBase64`, the file's bytes in base64 (or a `data:image/…;base64,` URL), and `imageUrl`, a public HTTPS URL Louez downloads; both or neither answers `UPLOAD_SOURCE_INVALID`. The type is read from the bytes: with `contentBase64`, a `contentType` that does not match them answers `UPLOAD_CONTENT_INVALID`; with `imageUrl`, the type is only detected from the bytes downloaded. Bytes that are no such image answer `UPLOAD_CONTENT_INVALID`, and text that is not base64 answers `UPLOAD_BASE64_INVALID`. A URL that does not answer 200 with the image, needs more than 3 redirects, takes more than 10 seconds on one of its requests, is not HTTPS or points to a private or local address answers `UPLOAD_URL_UNREACHABLE`; while too many images are being downloaded, `UPLOAD_IMPORT_BUSY` (429, retry a few seconds later). An image over 5 MB answers `UPLOAD_TOO_LARGE`. Each call stores a new image and changes no category. Returns the image's public `url`, which `imageUrl` takes in `POST /categories` and `PATCH /categories/{id}`, with its key, type and size.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "contentBase64",
            "flag": "content-base64",
            "kind": "string",
            "description": "The file's bytes, base64 (or a data:image/…;base64, URL), 5 MB at most once decoded. Use it when you cannot reach an upload URL, e.g. for an image you made in your own workspace."
          },
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "description": "The type of the bytes in contentBase64, when you know it; the bytes must match it."
          },
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "description": "A public HTTPS URL of the image instead of its bytes. Louez downloads it; private or local addresses are refused."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_list",
      "group": "products",
      "action": "list",
      "method": "GET",
      "path": "/products",
      "summary": "List Products",
      "description": "Lists the store's products in the catalog's order (as `POST /products/reorder` sets it, then newest first), with their price, stock and main category. Filter by `status` (every status by default), `categoryIds` (the products in any of them) or `search` (part of the name). Returns up to `limit` products (100 by default, 200 at most), the currency, and the count per status within the category and search filters. To read on, pass `nextCursor` back as `cursor` with the same filters; it is null on the last page. A product's tiers, units and accessories are in `GET /products/{id}`. Each product comes with `links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [],
      "query": [
        {
          "name": "status",
          "flag": "status",
          "kind": "string",
          "enum": [
            "all",
            "active",
            "draft",
            "archived"
          ],
          "description": "Only products with this status. Default all."
        },
        {
          "name": "categoryIds",
          "flag": "category-ids",
          "kind": "string",
          "list": true,
          "description": "Only products in any of these categories. Default every category."
        },
        {
          "name": "search",
          "flag": "search",
          "kind": "string",
          "description": "Part of the product name."
        },
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Products per page, 200 at most, 100 by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_create",
      "group": "products",
      "action": "create",
      "method": "POST",
      "path": "/products",
      "summary": "Create Product",
      "description": "Creates a product, with everything the dashboard's product form holds. Only `name` and a price are required: by default a product is active, priced by duration, returnable, with a stock of 1. A duration product has a base rate (`basePriceDuration`, such as `{ \"price\": \"30\", \"duration\": 1, \"unit\": \"day\" }`) and optional `rateTiers`: each tier is the total price of a rental of exactly its duration, such as `{ \"duration\": 7, \"unit\": \"day\", \"price\": \"150\" }` for a week. A fixed product (`pricingKind: fixed`) has one price per item. Seasons are set with `POST /products/{productId}/seasonal-pricings`. `images` takes the `url` a finished image upload returns (`POST /products/images`, or `POST /products/image-uploads` then `POST /products/image-uploads/complete`); any other image answers `PRODUCT_IMAGE_INVALID`. A product the form would refuse answers `PRODUCT_INVALID`, with each issue in `details.issues`. Returns the product as `GET /products/{id}` does. The product comes with `links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "required": true,
            "description": "Product name, 2 to 255 characters."
          },
          {
            "name": "description",
            "flag": "description",
            "kind": "string",
            "description": "Description shown on the storefront."
          },
          {
            "name": "aiContext",
            "flag": "ai-context",
            "kind": "string",
            "description": "Private notes for the storefront AI advisor (constraints, ideal uses). Never shown to customers."
          },
          {
            "name": "categoryIds",
            "flag": "category-ids",
            "kind": "string",
            "list": true,
            "description": "Ids of the store's categories (categories_list), main category first. Unknown ids are ignored."
          },
          {
            "name": "categoryId",
            "flag": "category-id",
            "kind": "string",
            "nullable": true,
            "description": "Former single category. Use categoryIds; ignored when categoryIds is sent."
          },
          {
            "name": "status",
            "flag": "status",
            "kind": "string",
            "enum": [
              "draft",
              "active",
              "archived"
            ],
            "description": "active: on the storefront; draft: hidden; archived: hidden and out of the catalog. Default active."
          },
          {
            "name": "pricingKind",
            "flag": "pricing-kind",
            "kind": "string",
            "enum": [
              "duration",
              "fixed"
            ],
            "description": "duration: the price depends on how long it is rented (base rate, tiers, seasons); fixed: one price per item, whatever the duration. Default duration."
          },
          {
            "name": "stockKind",
            "flag": "stock-kind",
            "kind": "string",
            "enum": [
              "returnable",
              "consumable",
              "untracked"
            ],
            "description": "returnable: comes back after the rental (the default); consumable: used up, sold with fixed pricing; untracked: no quantity limit."
          },
          {
            "name": "price",
            "flag": "price",
            "kind": "string",
            "description": "Decimal string, e.g. \"25.00\". For fixed pricing, the price per item. For duration pricing, the base price when basePriceDuration is left out."
          },
          {
            "name": "basePriceDuration",
            "flag": "base-price-duration",
            "kind": "json",
            "nullable": true,
            "description": "Base rate of a duration product: `price` for `duration` × `unit`, e.g. { \"price\": \"30\", \"duration\": 1, \"unit\": \"day\" } or { \"price\": \"20\", \"duration\": 4, \"unit\": \"hour\" }. Left out, it is `price` per 1 pricingMode. Null, as products_get gives it for fixed pricing, means none. Ignored for fixed pricing."
          },
          {
            "name": "pricingMode",
            "flag": "pricing-mode",
            "kind": "string",
            "enum": [
              "hour",
              "day",
              "week"
            ],
            "description": "Former base period (hour, day, week). Used only when basePriceDuration is left out; default day."
          },
          {
            "name": "rateTiers",
            "flag": "rate-tiers",
            "kind": "json",
            "description": "Degressive rates (prix dégressifs) of a duration product, on top of the base rate. Each tier is the TOTAL price of a rental of exactly that duration, not a price per unit: with a base rate of 30 per 1 day, `{ \"duration\": 3, \"unit\": \"day\", \"price\": \"75\" }` means 3 days cost 75 in all (25 a day). Durations are unique; `unit` is minute, hour, day or week; prices are decimal strings. With enforceStrictTiers true, a rental is rounded up to the next tier (or base) duration and charged that tier's price; with false, the price runs linearly between tiers. Sending the list replaces every tier; an empty list removes them. Ignored for fixed pricing."
          },
          {
            "name": "pricingTiers",
            "flag": "pricing-tiers",
            "kind": "json",
            "description": "Former percentage tiers ({ minDuration, discountPercent }). Use rateTiers; ignored when rateTiers is sent."
          },
          {
            "name": "enforceStrictTiers",
            "flag": "enforce-strict-tiers",
            "kind": "boolean",
            "description": "Duration pricing only. true: whole periods (a rental is charged the next tier or base duration up); false: prorated between tiers."
          },
          {
            "name": "deposit",
            "flag": "deposit",
            "kind": "string",
            "description": "Security deposit per item, decimal string, e.g. \"150\". Empty for none."
          },
          {
            "name": "quantity",
            "flag": "quantity",
            "kind": "string",
            "description": "Stock: how many items the store has. Ignored when trackUnits is true (the active units count). Default 1."
          },
          {
            "name": "images",
            "flag": "images",
            "kind": "string",
            "list": true,
            "description": "Image URLs, first one main. Upload each with products_upload_image, or with products_create_image_upload and products_complete_image_upload, then use the url it returns."
          },
          {
            "name": "imageHistory",
            "flag": "image-history",
            "kind": "json",
            "description": "The dashboard's record of each photo's versions; sending it replaces every version. Read the versions in imageVersions of products_get, and switch with products_use_image_version."
          },
          {
            "name": "videoUrl",
            "flag": "video-url",
            "kind": "string",
            "description": "A YouTube URL, or empty for none."
          },
          {
            "name": "taxSettings",
            "flag": "tax-settings",
            "kind": "json",
            "description": "{ inheritFromStore: true } uses the store's VAT rate; { inheritFromStore: false, customRate: 5.5 } sets one for this product."
          },
          {
            "name": "promotion",
            "flag": "promotion",
            "kind": "json",
            "nullable": true,
            "description": "A discount shown on the storefront: { percentage: 1 to 99, startsOn, endsOn } with YYYY-MM-DD dates or null for open ends; null for none."
          },
          {
            "name": "accessories",
            "flag": "accessories",
            "kind": "json",
            "description": "Other products of the store offered with this one: { accessoryId, required, quantity } (quantity per item of this product). required true books it with every rental. Sending the list replaces every link."
          },
          {
            "name": "trackUnits",
            "flag": "track-units",
            "kind": "boolean",
            "description": "Returnable products only: track each item as a unit with its own identifier."
          },
          {
            "name": "units",
            "flag": "units",
            "kind": "json",
            "description": "Individual units (serial numbers, asset tags) when trackUnits is true: the stock is then the number of active units. Each unit needs an identifier, and a value in `attributes` for every key of bookingAttributeAxes."
          },
          {
            "name": "bookingAttributeAxes",
            "flag": "booking-attribute-axes",
            "kind": "json",
            "description": "Variants customers choose when booking (size, colour), up to 3, with trackUnits only: { key: \"size\", label: \"Size\", position: 0 }. Each unit then carries a value per key."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_get",
      "group": "products",
      "action": "get",
      "method": "GET",
      "path": "/products/{id}",
      "summary": "Get Product",
      "description": "Returns one product with everything its form in the dashboard holds: pricing (base rate, tiers), deposit, taxes, promotion, stock, every unit (retired ones included), variants, accessories, categories, images and the versions of each photo (`imageVersions`). Edit it and send the fields to change to `PATCH /products/{id}`. The product comes with `links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_update",
      "group": "products",
      "action": "update",
      "method": "PATCH",
      "path": "/products/{id}",
      "summary": "Update Product",
      "description": "Changes a product. Send only the fields to change: a field left out stays as it is, and `null` clears the description, the AI context, the video or the tax settings. A list you send (`rateTiers`, `accessories`, `categoryIds`, `images`) replaces the stored one. `units` updates the units it holds (with their `id`) and adds the others; the units left out stay, and `removeUnitIds` deletes active units. `price` alone changes a duration product's base price. A duration product has a base rate (`basePriceDuration`, such as `{ \"price\": \"30\", \"duration\": 1, \"unit\": \"day\" }`) and optional `rateTiers`: each tier is the total price of a rental of exactly its duration, such as `{ \"duration\": 7, \"unit\": \"day\", \"price\": \"150\" }` for a week. A fixed product (`pricingKind: fixed`) has one price per item. Seasons are set with `POST /products/{productId}/seasonal-pricings`. Refused with `PRODUCT_UNITS_ASSIGNED` for deleting a unit a current or future reservation holds, `PRODUCT_STOCK_KIND_LOCKED` for changing the stock kind while a confirmed or ongoing reservation holds the product, and `PRODUCT_UNIT_TRACKING_IN_USE` for turning unit tracking off while current or future reservations booked specific variants. When the change archives the product, deletes its tiers and seasons (by switching to fixed pricing) or deletes units (`removeUnitIds`, or unit tracking turned off), on a key that asks for confirmations it asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of what goes. Returns the product. The product comes with `links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "description": "Product name, 2 to 255 characters."
          },
          {
            "name": "description",
            "flag": "description",
            "kind": "string",
            "nullable": true,
            "description": "New description; null clears it."
          },
          {
            "name": "aiContext",
            "flag": "ai-context",
            "kind": "string",
            "nullable": true,
            "description": "Null clears it."
          },
          {
            "name": "categoryIds",
            "flag": "category-ids",
            "kind": "string",
            "list": true,
            "description": "Ids of the store's categories (categories_list), main category first. Unknown ids are ignored."
          },
          {
            "name": "categoryId",
            "flag": "category-id",
            "kind": "string",
            "nullable": true,
            "description": "Former single category. Use categoryIds; ignored when categoryIds is sent."
          },
          {
            "name": "status",
            "flag": "status",
            "kind": "string",
            "enum": [
              "draft",
              "active",
              "archived"
            ],
            "description": "active: on the storefront; draft: hidden; archived: hidden and out of the catalog. Default active."
          },
          {
            "name": "pricingKind",
            "flag": "pricing-kind",
            "kind": "string",
            "enum": [
              "duration",
              "fixed"
            ],
            "description": "duration: the price depends on how long it is rented (base rate, tiers, seasons); fixed: one price per item, whatever the duration. Default duration."
          },
          {
            "name": "stockKind",
            "flag": "stock-kind",
            "kind": "string",
            "enum": [
              "returnable",
              "consumable",
              "untracked"
            ],
            "description": "returnable: comes back after the rental (the default); consumable: used up, sold with fixed pricing; untracked: no quantity limit."
          },
          {
            "name": "price",
            "flag": "price",
            "kind": "string",
            "description": "Decimal string, e.g. \"25.00\". For fixed pricing, the price per item. For duration pricing, the base price when basePriceDuration is left out."
          },
          {
            "name": "basePriceDuration",
            "flag": "base-price-duration",
            "kind": "json",
            "nullable": true,
            "description": "Base rate of a duration product: `price` for `duration` × `unit`, e.g. { \"price\": \"30\", \"duration\": 1, \"unit\": \"day\" } or { \"price\": \"20\", \"duration\": 4, \"unit\": \"hour\" }. Left out, it is `price` per 1 pricingMode. Null, as products_get gives it for fixed pricing, means none. Ignored for fixed pricing."
          },
          {
            "name": "pricingMode",
            "flag": "pricing-mode",
            "kind": "string",
            "enum": [
              "hour",
              "day",
              "week"
            ],
            "description": "Former base period (hour, day, week). Used only when basePriceDuration is left out; default day."
          },
          {
            "name": "rateTiers",
            "flag": "rate-tiers",
            "kind": "json",
            "description": "Degressive rates (prix dégressifs) of a duration product, on top of the base rate. Each tier is the TOTAL price of a rental of exactly that duration, not a price per unit: with a base rate of 30 per 1 day, `{ \"duration\": 3, \"unit\": \"day\", \"price\": \"75\" }` means 3 days cost 75 in all (25 a day). Durations are unique; `unit` is minute, hour, day or week; prices are decimal strings. With enforceStrictTiers true, a rental is rounded up to the next tier (or base) duration and charged that tier's price; with false, the price runs linearly between tiers. Sending the list replaces every tier; an empty list removes them. Ignored for fixed pricing."
          },
          {
            "name": "pricingTiers",
            "flag": "pricing-tiers",
            "kind": "json",
            "description": "Former percentage tiers ({ minDuration, discountPercent }). Use rateTiers; ignored when rateTiers is sent."
          },
          {
            "name": "enforceStrictTiers",
            "flag": "enforce-strict-tiers",
            "kind": "boolean",
            "description": "Duration pricing only. true: whole periods (a rental is charged the next tier or base duration up); false: prorated between tiers."
          },
          {
            "name": "deposit",
            "flag": "deposit",
            "kind": "string",
            "description": "Security deposit per item, decimal string, e.g. \"150\". Empty for none."
          },
          {
            "name": "quantity",
            "flag": "quantity",
            "kind": "string",
            "description": "Stock: how many items the store has. Ignored when trackUnits is true (the active units count). Default 1."
          },
          {
            "name": "images",
            "flag": "images",
            "kind": "string",
            "list": true,
            "description": "Image URLs, first one main. Upload each with products_upload_image, or with products_create_image_upload and products_complete_image_upload, then use the url it returns."
          },
          {
            "name": "imageHistory",
            "flag": "image-history",
            "kind": "json",
            "description": "The dashboard's record of each photo's versions; sending it replaces every version. Read the versions in imageVersions of products_get, and switch with products_use_image_version."
          },
          {
            "name": "videoUrl",
            "flag": "video-url",
            "kind": "string",
            "nullable": true,
            "description": "A YouTube URL; null or empty removes it."
          },
          {
            "name": "taxSettings",
            "flag": "tax-settings",
            "kind": "json",
            "nullable": true,
            "description": "Null goes back to the store's VAT rate."
          },
          {
            "name": "promotion",
            "flag": "promotion",
            "kind": "json",
            "nullable": true,
            "description": "A discount shown on the storefront: { percentage: 1 to 99, startsOn, endsOn } with YYYY-MM-DD dates or null for open ends; null for none."
          },
          {
            "name": "accessories",
            "flag": "accessories",
            "kind": "json",
            "description": "Other products of the store offered with this one: { accessoryId, required, quantity } (quantity per item of this product). required true books it with every rental. Sending the list replaces every link."
          },
          {
            "name": "trackUnits",
            "flag": "track-units",
            "kind": "boolean",
            "description": "Returnable products only: track each item as a unit with its own identifier."
          },
          {
            "name": "units",
            "flag": "units",
            "kind": "json",
            "description": "Units to update (with their `id`) or add (without), when trackUnits is true. Units left out stay as they are: removeUnitIds deletes units. Each unit needs an identifier, and a value in `attributes` for every key of bookingAttributeAxes."
          },
          {
            "name": "bookingAttributeAxes",
            "flag": "booking-attribute-axes",
            "kind": "json",
            "description": "Variants customers choose when booking (size, colour), up to 3, with trackUnits only: { key: \"size\", label: \"Size\", position: 0 }. Each unit then carries a value per key."
          },
          {
            "name": "removeUnitIds",
            "flag": "remove-unit-ids",
            "kind": "string",
            "list": true,
            "description": "Ids of active units to delete (refused while a reservation holds one). The first call answers CONFIRMATION_REQUIRED with the units it deletes."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_delete",
      "group": "products",
      "action": "delete",
      "method": "DELETE",
      "path": "/products/{id}",
      "summary": "Delete Product",
      "description": "Deletes a product for good, with its units and its links to categories and accessories, both ways. The reservations with this product keep their lines. Refused with `PRODUCT_UNITS_ASSIGNED` while a current or future reservation holds one of its units. To take a product off the online store without deleting it, archive it with `POST /products/{id}/status`. On a key that asks for confirmations, it asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the units it deletes and the number of reservations with the product. Returns the product's id and the number of units deleted.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_list_units",
      "group": "units",
      "action": "list",
      "method": "GET",
      "path": "/products/{id}/units",
      "summary": "List Product Units",
      "description": "Lists a product's units (serial numbers, asset tags), retired ones included, by identifier: id, identifier, variant values and whether it is active or retired. Without `limit`, the answer holds every unit; with one (500 at most), pass `nextCursor` back as `cursor` to read on; it is null on the last page. `total` counts every unit.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true,
          "description": "The product's id."
        }
      ],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, to read on. Without it, the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per page, at most 500. Without it, a page holds 100 over MCP and every item over the REST API."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_update_status",
      "group": "products",
      "action": "update-status",
      "method": "POST",
      "path": "/products/{id}/status",
      "summary": "Change Product Status",
      "description": "Publishes (`active`), unpublishes (`draft`) or archives (`archived`) a product. Archiving takes it off the online store and out of the catalog; its reservations are kept. On a key that asks for confirmations, archiving asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the number of pending, confirmed and ongoing reservations that hold it. Returns the new and the previous status, and the product's `links.dashboard`, its page in the Louez dashboard, and, once active and while the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "status",
            "flag": "status",
            "kind": "string",
            "enum": [
              "draft",
              "active",
              "archived"
            ],
            "required": true,
            "description": "active: on the storefront; draft: hidden; archived: hidden and out of the catalog."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_duplicate",
      "group": "products",
      "action": "duplicate",
      "method": "POST",
      "path": "/products/{id}/duplicate",
      "summary": "Duplicate Product",
      "description": "Copies a product as a draft named \"<name> (copy)\", with its pricing, tiers, deposit, taxes, images, video and categories. Units are not copied: the copy does not track units, and its stock is the number of items the original has. Its accessories and promotion are not copied either. Returns the new product, with `links.dashboard`, its page in the Louez dashboard (a draft has no page on the online store).",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_reorder",
      "group": "products",
      "action": "reorder",
      "method": "POST",
      "path": "/products/reorder",
      "summary": "Reorder Products",
      "description": "Sets the order of products, as the online store and the dashboard show them. Send the product `ids` in their new order (5,000 at most): they swap among the places they already hold, and the products left out keep theirs. Ids the store does not have are ignored. Returns each product sent with its new `position`.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "ids",
            "flag": "ids",
            "kind": "string",
            "list": true,
            "required": true,
            "description": "Product ids in their new order. They swap among the places they already hold; products left out keep theirs. Ids of other stores are ignored."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_create_image_upload",
      "group": "products",
      "action": "create-image-upload",
      "method": "POST",
      "path": "/products/image-uploads",
      "summary": "Start Product Image Upload",
      "description": "Starts uploading a product image: send its `contentType` (JPEG, PNG, GIF or WebP) and its `size` in bytes, 15 MB at most (`UPLOAD_TOO_LARGE` above). Returns a `key` and an `upload`, the one HTTP request that sends the file's bytes: make it as given (a PUT with its `headers`, or a multipart POST with its `fields`, then the file as `file`), without an `Authorization` header, before `expiresAt`, 10 minutes later. Then `POST /products/image-uploads/complete` with the key checks the file and publishes it.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "required": true,
            "description": "The image's type. Send the bytes with exactly this Content-Type."
          },
          {
            "name": "size",
            "flag": "size",
            "kind": "integer",
            "required": true,
            "description": "The file's size in bytes."
          }
        ]
      },
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_complete_image_upload",
      "group": "products",
      "action": "complete-image-upload",
      "method": "POST",
      "path": "/products/image-uploads/complete",
      "summary": "Complete Product Image Upload",
      "description": "Finishes an upload started with `POST /products/image-uploads`: checks the file sent to the `key`, makes it publicly readable and returns its `url`, type and size. A product takes that url in its `images` (`POST /products`, `PATCH /products/{id}`); this call changes no product and deletes nothing. A key with nothing uploaded answers `UPLOAD_NOT_FOUND`, and a key that is not a product upload of the store `UPLOAD_NOT_OWNED`. A file that is not a valid image of the declared type answers `UPLOAD_CONTENT_INVALID` and stays private: start a new upload. Completing a good upload again returns the same answer.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "key",
            "flag": "key",
            "kind": "string",
            "required": true,
            "description": "The key the create-upload call returned."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_upload_image",
      "group": "products",
      "action": "upload-image",
      "method": "POST",
      "path": "/products/images",
      "summary": "Upload Product Image",
      "description": "Uploads a product image (JPEG, PNG, GIF or WebP) in one call, from exactly one of: its bytes as base64 in `contentBase64` (or a `data:image/…;base64,` URL), 5 MB at most once decoded; or a public HTTPS `imageUrl`, which Louez downloads, 15 MB at most. Both or neither answer `UPLOAD_SOURCE_INVALID`. The type is read from the bytes: with `contentBase64`, a `contentType` sent must match them; with `imageUrl`, the type is only detected from the bytes downloaded. An `imageUrl` must answer 200 with the image, following at most 3 redirects, each request within 10 seconds; private and local addresses are refused, and a download that fails answers `UPLOAD_URL_UNREACHABLE`. Each call stores a new image and changes no product. Returns the image's public `url`, which a product takes in its `images` (`POST /products`, `PATCH /products/{id}`).",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "contentBase64",
            "flag": "content-base64",
            "kind": "string",
            "description": "The file's bytes, base64 (or a data:image/…;base64, URL), 5 MB at most once decoded. Use it when you cannot reach an upload URL, e.g. for an image you made in your own workspace."
          },
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "description": "The type of the bytes in contentBase64, when you know it; the bytes must match it."
          },
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "description": "A public HTTPS URL of the image instead of its bytes. Louez downloads it; private or local addresses are refused."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_enhance_image",
      "group": "products",
      "action": "enhance-image",
      "method": "POST",
      "path": "/products/{id}/images/enhance",
      "summary": "Enhance Product Photo with AI",
      "description": "Enhances one photo of a product with AI: a clean studio photo of the same product on a cut-out background, framed 4:3. Send the product's id and `imageUrl`, one of its `images` as `GET /products/{id}` returns them. A photo already enhanced answers `IMAGE_ALREADY_PROCESSED` (enhance its original instead); a photo whose background was removed can still be enhanced. It runs in the background, usually 1 to 4 minutes: the answer is the job, at once, with status `queued`, and `GET /jobs/{id}` says how it goes (its `waitSeconds` waits up to 25 seconds for the end). Once it succeeds, the result replaces the photo on the product, and so on its online page; the original stays among the photo's versions (`imageVersions` in `GET /products/{id}`), and `POST /products/{id}/images/use-version` with the job's `source.versionId` puts it back. The job holds the photo before (`source.url`) and, once done, after (`result.url`). It costs AI credits (`priceCredits`; 0 when free or not billed on this instance), charged only once the result is on the product, never for a failed run; without enough credits, it answers `AI_CREDITS_EXHAUSTED`. A paid run always asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), whatever the key's confirmation setting, with the price and the store's balance. The same photo sent again while its job runs returns that job; another AI operation running on it answers `IMAGE_JOB_RUNNING`. A store has at most 3 photos processed at once (`IMAGE_JOBS_BUSY` beyond). A photo that is not one of the product's `images` answers `IMAGE_NOT_ON_PRODUCT`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "required": true,
            "description": "The photo to process: one of the product's `images`, as products_get returns it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_remove_image_background",
      "group": "products",
      "action": "remove-image-background",
      "method": "POST",
      "path": "/products/{id}/images/remove-background",
      "summary": "Remove Product Photo Background",
      "description": "Removes the background of one photo of a product: the product alone on transparency, centred, with no AI redrawing. Send the product's id and `imageUrl`, one of its `images` as `GET /products/{id}` returns them. A photo already processed (background removed or AI enhanced) answers `IMAGE_ALREADY_PROCESSED`. It runs in the background, usually 1 to 2 minutes: the answer is the job, at once, with status `queued`, and `GET /jobs/{id}` says how it goes (its `waitSeconds` waits up to 25 seconds for the end). Once it succeeds, the result replaces the photo on the product, and so on its online page; the original stays among the photo's versions (`imageVersions` in `GET /products/{id}`), and `POST /products/{id}/images/use-version` with the job's `source.versionId` puts it back. The job holds the photo before (`source.url`) and, once done, after (`result.url`). It costs AI credits (`priceCredits`; 0 when free or not billed on this instance), charged only once the result is on the product, never for a failed run; without enough credits, it answers `AI_CREDITS_EXHAUSTED`. A paid run always asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), whatever the key's confirmation setting, with the price and the store's balance. The same photo sent again while its job runs returns that job; another AI operation running on it answers `IMAGE_JOB_RUNNING`. A store has at most 3 photos processed at once (`IMAGE_JOBS_BUSY` beyond). A photo that is not one of the product's `images` answers `IMAGE_NOT_ON_PRODUCT`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "required": true,
            "description": "The photo to process: one of the product's `images`, as products_get returns it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_use_image_version",
      "group": "products",
      "action": "use-image-version",
      "method": "POST",
      "path": "/products/{id}/images/use-version",
      "summary": "Use Product Photo Version",
      "description": "Puts one of a photo's versions in use on the product: its original, a crop, an AI enhancement or a background removal, as `imageVersions` in `GET /products/{id}` lists them, or a job's `source.versionId`. The version takes the photo's place in `images`, on the product and its online page. No version is deleted, so this undoes an AI enhancement or a background removal, and can be reversed the same way. Send the product's id and the `versionId`. An unknown version answers `IMAGE_VERSION_NOT_FOUND`; a version whose photo is no longer on the product answers `IMAGE_VERSION_PHOTO_REMOVED` (add its url to `images` with `PATCH /products/{id}` instead). Returns the product. The product comes with `links.dashboard`, its page in the Louez dashboard, and, while it is active and the store is online, `links.storefront`, its page on the online store.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "versionId",
            "flag": "version-id",
            "kind": "string",
            "required": true,
            "description": "A version's id, from imageVersions of products_get or the source of a job."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_get_activity",
      "group": "products",
      "action": "get-activity",
      "method": "GET",
      "path": "/products/{id}/activity",
      "summary": "Get Product Activity",
      "description": "Returns the history of a product's units, newest first: units created, changed, retired or reinstated, their downtimes declared, changed, closed or deleted, and their assignments to reservations. The events of units deleted since are left out. Returns up to `limit` events (12 by default, 50 at most); to read on, pass `nextCursor` back as `cursor`; it is null on the last page. Its events name reservations, so it needs a key that can read products, reservations and customers; another key answers `PERMISSION_DENIED`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Events per page, 50 at most."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_get_reservation_timeline",
      "group": "products",
      "action": "get-reservation-timeline",
      "method": "GET",
      "path": "/products/{id}/reservation-timeline",
      "summary": "Get Product Reservation Timeline",
      "description": "Shows when a product is out between `from` and `to` (ISO 8601, at most 400 days apart, or `PRODUCT_TIMELINE_RANGE_INVALID`): the reservations with this product whose dates overlap the window, by start date, each with its status, dates, customer's name, amounts, quantity of the product, assigned units and lines; and the downtimes of its units in the window. Without `limit`, the answer holds every reservation; with one (500 at most), pass `nextCursor` back as `cursor` to read on. Every page holds all the downtimes. It needs a key that can read products, reservations and customers; another key answers `PERMISSION_DENIED`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [
        {
          "name": "from",
          "flag": "from",
          "kind": "string",
          "required": true,
          "description": "Start of the window, ISO 8601 with a time zone."
        },
        {
          "name": "to",
          "flag": "to",
          "kind": "string",
          "required": true,
          "description": "End of the window, ISO 8601, at most 400 days after from."
        },
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, to read on. Without it, the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per page, at most 500. Without it, a page holds 100 over MCP and every item over the REST API."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_list_seasonal_pricings",
      "group": "seasonal-pricing",
      "action": "list",
      "method": "GET",
      "path": "/products/{productId}/seasonal-pricings",
      "summary": "List Seasonal Prices",
      "description": "Lists a product's seasonal prices by start day, with their tiers. A season replaces the product's base rate and tiers on its days, from `startDate` to `endDate` (YYYY-MM-DD, both included); the seasons of a product never overlap. Its tiers mean what the product's `rateTiers` mean: the total price of a rental of exactly that duration. Returns up to `limit` seasons (200 by default and at most); to read on, pass `nextCursor` back as `cursor`; it is null on the last page.",
      "pathParams": [
        {
          "name": "productId",
          "flag": "product-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Seasons per page, 200 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_create_seasonal_pricing",
      "group": "seasonal-pricing",
      "action": "create",
      "method": "POST",
      "path": "/products/{productId}/seasonal-pricings",
      "summary": "Create Seasonal Price",
      "description": "Adds a seasonal price to a product priced by duration: a `name`, its days, its base `price` (for the product's base duration) and optional `rateTiers` (50 at most). A season replaces the product's base rate and tiers on its days, from `startDate` to `endDate` (YYYY-MM-DD, both included); the seasons of a product never overlap. Its tiers mean what the product's `rateTiers` mean: the total price of a rental of exactly that duration. `endDate` must come after `startDate` (`SEASONAL_PRICING_DATES_INVALID`). Refused with `SEASONAL_PRICING_OVERLAP` for days that overlap another season of the product (its id in `details.overlappingId`), and with `SEASONAL_PRICING_FIXED_PRODUCT` for a product with fixed pricing. Returns the season.",
      "pathParams": [
        {
          "name": "productId",
          "flag": "product-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "required": true,
            "description": "A name for the season, e.g. Summer."
          },
          {
            "name": "startDate",
            "flag": "start-date",
            "kind": "string",
            "required": true,
            "description": "A day, YYYY-MM-DD."
          },
          {
            "name": "endDate",
            "flag": "end-date",
            "kind": "string",
            "required": true,
            "description": "A day, YYYY-MM-DD."
          },
          {
            "name": "price",
            "flag": "price",
            "kind": "string",
            "required": true,
            "description": "The season's base price, for the product's base duration."
          },
          {
            "name": "rateTiers",
            "flag": "rate-tiers",
            "kind": "json",
            "description": "The season's tiers, same meaning as the product's rateTiers. A season replaces the product's base rate and tiers on the days from startDate to endDate (both included). Seasons of one product never overlap."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_update_seasonal_pricing",
      "group": "seasonal-pricing",
      "action": "update",
      "method": "PATCH",
      "path": "/products/seasonal-pricings/{id}",
      "summary": "Update Seasonal Price",
      "description": "Changes a seasonal price. Send only the fields to change; `rateTiers` sent replaces the season's tiers, and an empty list removes them. A season replaces the product's base rate and tiers on its days, from `startDate` to `endDate` (YYYY-MM-DD, both included); the seasons of a product never overlap. Its tiers mean what the product's `rateTiers` mean: the total price of a rental of exactly that duration. Refused with `SEASONAL_PRICING_DATES_INVALID` when `endDate` does not come after `startDate`, and with `SEASONAL_PRICING_OVERLAP` for days that overlap another season of the product. Returns the season.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "description": "A name for the season, e.g. Summer."
          },
          {
            "name": "startDate",
            "flag": "start-date",
            "kind": "string",
            "description": "A day, YYYY-MM-DD."
          },
          {
            "name": "endDate",
            "flag": "end-date",
            "kind": "string",
            "description": "A day, YYYY-MM-DD."
          },
          {
            "name": "price",
            "flag": "price",
            "kind": "string",
            "description": "The season's base price, for the product's base duration."
          },
          {
            "name": "rateTiers",
            "flag": "rate-tiers",
            "kind": "json",
            "description": "The season's tiers, same meaning as the product's rateTiers. A season replaces the product's base rate and tiers on the days from startDate to endDate (both included). Seasons of one product never overlap."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_delete_seasonal_pricing",
      "group": "seasonal-pricing",
      "action": "delete",
      "method": "DELETE",
      "path": "/products/seasonal-pricings/{id}",
      "summary": "Delete Seasonal Price",
      "description": "Deletes a seasonal price and its tiers: the product's own rates apply on its days again. On a key that asks for confirmations, it asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the season, its product and its number of tiers. Returns the season's id and its product's id.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_duplicate_seasonal_pricing",
      "group": "seasonal-pricing",
      "action": "duplicate",
      "method": "POST",
      "path": "/products/seasonal-pricings/{id}/duplicate",
      "summary": "Duplicate Seasonal Price",
      "description": "Copies a seasonal price one year later, with its tiers, named \"<name> (copie)\". Refused with `SEASONAL_PRICING_OVERLAP` when the new days overlap another season of the product. Returns the new season.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_get_unit_history",
      "group": "units",
      "action": "get-history",
      "method": "GET",
      "path": "/products/units/{unitId}/history",
      "summary": "Get Unit History",
      "description": "Returns a unit's history. `timeline` holds, newest first, its events (created, changed, retired, reinstated, downtimes declared, changed, closed or deleted) with who did them, and the reservations it was assigned to, with their number, customer and dates. `downtimes` holds its downtimes, current first, then upcoming, then past. Without `limit`, the timeline comes whole; with one (500 at most), pass `nextCursor` back as `cursor` to read on, and every page holds the downtimes. As it shows the reservations and customers the unit served, it needs a key that can read reservations and customers, else `PERMISSION_DENIED`. A unit's id is in `GET /products/{id}/units`.",
      "pathParams": [
        {
          "name": "unitId",
          "flag": "unit-id",
          "kind": "string",
          "required": true,
          "description": "The unit's id, from products_get (units[].id)."
        }
      ],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, to read on. Without it, the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per page, at most 500. Without it, a page holds 100 over MCP and every item over the REST API."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_declare_downtime",
      "group": "units",
      "action": "declare-downtime",
      "method": "POST",
      "path": "/products/units/{unitId}/downtimes",
      "summary": "Declare Unit Downtime",
      "description": "Takes a unit out of service for a `reason` (`maintenance`, `repair` or `other`) from `startsAt` until `endsAt`, ISO 8601 dates; without `endsAt`, or with null, until `POST /products/downtimes/{downtimeId}/close` ends it. The unit cannot be booked then. `endsAt` must come after `startsAt` (`DOWNTIME_DATES_INVALID`); `note` holds up to 2,000 characters. Reservations that already hold the unit then keep it, and come back in `conflicts`, each with the units that could serve it instead (`replacementCandidates`). When there are any, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of those reservations. `excludeReservationItemIds` (100 at most) leaves out of `conflicts` the lines of reservations whose return inspection is done, the unit being back; any other line is refused with `DOWNTIME_EXCLUSION_INVALID`, and a confirmation still names every booking. With a key that cannot read reservations, a booking's `reservationId` and `reservationNumber` are null; with one that cannot read customers, so is its `customerName`. Its dates are always given. Returns the downtime's id and the conflicts. A unit's id is in `GET /products/{id}/units`.",
      "pathParams": [
        {
          "name": "unitId",
          "flag": "unit-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "reason",
            "flag": "reason",
            "kind": "string",
            "enum": [
              "maintenance",
              "repair",
              "other"
            ],
            "required": true,
            "description": "maintenance, repair or other."
          },
          {
            "name": "startsAt",
            "flag": "starts-at",
            "kind": "string",
            "required": true,
            "description": "When the unit goes out, ISO 8601 with a time zone."
          },
          {
            "name": "endsAt",
            "flag": "ends-at",
            "kind": "string",
            "nullable": true,
            "description": "When it is back, after startsAt. Null or left out: until closed."
          },
          {
            "name": "note",
            "flag": "note",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "excludeReservationItemIds",
            "flag": "exclude-reservation-item-ids",
            "kind": "string",
            "list": true,
            "description": "Lines of reservations whose return inspection is done and that hold this unit (the unit is back): they are left out of the conflicts returned. Any other line is refused. A confirmation still names every booking."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_update_downtime",
      "group": "units",
      "action": "update-downtime",
      "method": "PATCH",
      "path": "/products/downtimes/{downtimeId}",
      "summary": "Update Unit Downtime",
      "description": "Changes a downtime's `reason`, `startsAt`, `endsAt` or `note`. Send only the fields to change; `endsAt: null` makes it last until closed, `note: null` clears the note. The end must still come after the start (`DOWNTIME_DATES_INVALID`). Reservations that hold the unit over the new dates keep it, and come back in `conflicts`, each with the units that could serve it instead (`replacementCandidates`). When there are any, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of those reservations. `excludeReservationItemIds` (100 at most) leaves out of `conflicts` the lines of reservations whose return inspection is done, the unit being back; any other line is refused with `DOWNTIME_EXCLUSION_INVALID`, and a confirmation still names every booking. With a key that cannot read reservations, a booking's `reservationId` and `reservationNumber` are null; with one that cannot read customers, so is its `customerName`. Its dates are always given. Returns the downtime's id and the conflicts. A downtime's id is in `GET /products/units/{unitId}/history`.",
      "pathParams": [
        {
          "name": "downtimeId",
          "flag": "downtime-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "reason",
            "flag": "reason",
            "kind": "string",
            "enum": [
              "maintenance",
              "repair",
              "other"
            ],
            "description": "maintenance, repair or other."
          },
          {
            "name": "startsAt",
            "flag": "starts-at",
            "kind": "string"
          },
          {
            "name": "endsAt",
            "flag": "ends-at",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "note",
            "flag": "note",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "excludeReservationItemIds",
            "flag": "exclude-reservation-item-ids",
            "kind": "string",
            "list": true,
            "description": "Lines of reservations whose return inspection is done and that hold this unit (the unit is back): they are left out of the conflicts returned. Any other line is refused. A confirmation still names every booking."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_delete_downtime",
      "group": "units",
      "action": "delete-downtime",
      "method": "DELETE",
      "path": "/products/downtimes/{downtimeId}",
      "summary": "Delete Unit Downtime",
      "description": "Deletes a downtime entered by mistake, as if it never was: the unit is available on its days again, and the unit's history keeps a record of it. To end a downtime, use `POST /products/downtimes/{downtimeId}/close`. It asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of the unit, its product and the downtime. Returns the downtime's id. A downtime's id is in `GET /products/units/{unitId}/history`.",
      "pathParams": [
        {
          "name": "downtimeId",
          "flag": "downtime-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_close_downtime",
      "group": "units",
      "action": "close-downtime",
      "method": "POST",
      "path": "/products/downtimes/{downtimeId}/close",
      "summary": "Close Unit Downtime",
      "description": "Ends a downtime: the unit is back in service from `endsAt`, now by default. `endsAt` must come after the downtime's start (`DOWNTIME_DATES_INVALID`) and not after its current end: closing only ends a downtime earlier, and a later end answers `DOWNTIME_CLOSE_EXTENDS` (`PATCH /products/downtimes/{downtimeId}` moves it, and checks the bookings it would overlap). Returns the downtime's id and when it ends. A downtime's id is in `GET /products/units/{unitId}/history`.",
      "pathParams": [
        {
          "name": "downtimeId",
          "flag": "downtime-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "endsAt",
            "flag": "ends-at",
            "kind": "string",
            "description": "When the unit is back: after the downtime's start, and not after its current end. Default: now."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_retire_unit",
      "group": "units",
      "action": "retire",
      "method": "POST",
      "path": "/products/units/{unitId}/retire",
      "summary": "Retire Unit",
      "description": "Retires a unit for good, with a `reason` (`sold`, `lost`, `broken` or `other`) and an optional `note`: it leaves the stock from now on and can no longer be booked. `POST /products/units/{unitId}/reinstate` undoes it. Refused with `UNIT_ALREADY_RETIRED` for a retired unit. Current and future reservations that hold it keep it, and come back in `conflicts`, each with the units that could serve it instead (`replacementCandidates`). Even when there are none, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of those reservations. With a key that cannot read reservations, a booking's `reservationId` and `reservationNumber` are null; with one that cannot read customers, so is its `customerName`. Its dates are always given. Returns the unit's id and the conflicts. A unit's id is in `GET /products/{id}/units`.",
      "pathParams": [
        {
          "name": "unitId",
          "flag": "unit-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "reason",
            "flag": "reason",
            "kind": "string",
            "enum": [
              "sold",
              "lost",
              "broken",
              "other"
            ],
            "required": true,
            "description": "sold, lost, broken or other."
          },
          {
            "name": "note",
            "flag": "note",
            "kind": "string",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_reinstate_unit",
      "group": "units",
      "action": "reinstate",
      "method": "POST",
      "path": "/products/units/{unitId}/reinstate",
      "summary": "Reinstate Unit",
      "description": "Puts a retired unit back in service: it can be booked again. Refused with `UNIT_NOT_RETIRED` for a unit in service. Returns the unit's id.",
      "pathParams": [
        {
          "name": "unitId",
          "flag": "unit-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_update_unit_details",
      "group": "units",
      "action": "update-details",
      "method": "PATCH",
      "path": "/products/units/{unitId}",
      "summary": "Update Unit Details",
      "description": "Changes a unit's `notes` (up to 1,000 characters), `purchasePrice` (a decimal string with at most 2 decimals, e.g. `\"450.00\"`) or `purchasedAt`. Send only the fields to change; null clears one. A unit's name and variant values change through `PATCH /products/{id}`. Returns the unit's notes and purchase details. A unit's id is in `GET /products/{id}/units`.",
      "pathParams": [
        {
          "name": "unitId",
          "flag": "unit-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "purchasePrice",
            "flag": "purchase-price",
            "kind": "string",
            "nullable": true,
            "description": "What the unit cost, e.g. \"450.00\"."
          },
          {
            "name": "purchasedAt",
            "flag": "purchased-at",
            "kind": "string",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_list_variants",
      "group": "variants",
      "action": "list",
      "method": "GET",
      "path": "/variants",
      "summary": "List Variants",
      "description": "Lists the store's variants with their values, in the catalog's order. Returns up to `limit` variants (100 by default and at most, as many as a store may hold); pass `nextCursor` back as `cursor` to read on; it is null on the last page. A variant (size, color…) is shared by the store's products: a product books by it when its key is one of the product's `bookingAttributeAxes`, and each of its units then carries one of its values in `attributes`. `PATCH /products/{id}` sets both.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Variants per page, 100 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_create_variant",
      "group": "variants",
      "action": "create",
      "method": "POST",
      "path": "/variants",
      "summary": "Create Variant",
      "description": "Adds a variant to the store's catalog: its `label` (2 to 50 characters), its `kind` (`size`, `color` or `custom`, the default), its `key` (up to 32 characters, derived from the label by default) and up to 100 `values` to start with, each with its `colorHex` for a color. A key, or a label without a key, that has no letter or digit is refused with `VARIANT_INVALID`. When the store already has a variant with that key, it is returned as is, with `created: false`; the starting values are only added to a variant that has none yet. A store holds at most 100 variants (`VARIANT_LIMIT_REACHED`). Returns the variant with its values. A variant (size, color…) is shared by the store's products: a product books by it when its key is one of the product's `bookingAttributeAxes`, and each of its units then carries one of its values in `attributes`. `PATCH /products/{id}` sets both.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "key",
            "flag": "key",
            "kind": "string",
            "description": "Canonical key, e.g. size. Default: derived from the label."
          },
          {
            "name": "label",
            "flag": "label",
            "kind": "string",
            "required": true,
            "description": "The name shown, e.g. Taille."
          },
          {
            "name": "kind",
            "flag": "kind",
            "kind": "string",
            "enum": [
              "size",
              "color",
              "custom"
            ],
            "description": "size, color or custom (default)."
          },
          {
            "name": "isActive",
            "flag": "is-active",
            "kind": "boolean"
          },
          {
            "name": "values",
            "flag": "values",
            "kind": "json",
            "description": "Values to start with; only added when the variant has none yet."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_update_variant",
      "group": "variants",
      "action": "update",
      "method": "PATCH",
      "path": "/variants/{id}",
      "summary": "Update Variant",
      "description": "Renames a variant (`label`, 2 to 50 characters). Its `key` stays, so the products that book by it keep it. Returns the variant with its values.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "label",
            "flag": "label",
            "kind": "string",
            "required": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_delete_variant",
      "group": "variants",
      "action": "delete",
      "method": "DELETE",
      "path": "/variants/{id}",
      "summary": "Delete Variant",
      "description": "Deletes a variant and its values from the catalog. Refused with `VARIANT_IN_USE` while products use it, as a booking axis or through their units' values: `details.productCount` counts them and `details.products` names them. `GET /variants/usage` lists them too, and `POST /variants/{id}/withdraw` takes the variant off them. It asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of the variant and how many values it has. Returns the variant's id.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_set_variant_active",
      "group": "variants",
      "action": "set-active",
      "method": "POST",
      "path": "/variants/{id}/active",
      "summary": "Turn Variant On or Off",
      "description": "Turns a variant on or off (`isActive`). Off only stops offering it when editing products: the products that carry it keep it, and `POST /variants/{id}/withdraw` takes it off them. Returns the variant's id and `isActive`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "isActive",
            "flag": "is-active",
            "kind": "boolean",
            "required": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_get_variant_usage",
      "group": "variants",
      "action": "get-usage",
      "method": "GET",
      "path": "/variants/usage",
      "summary": "Get Variant Usage",
      "description": "Says which products use each variant, as a booking axis or through their units' values: what `POST /variants/{id}/withdraw` would change, and what keeps `DELETE /variants/{id}` from deleting it. Pass `definitionId` for one variant; by default, every variant. Each comes with its `productCount` and its `products`, the first 200 by name, each with `links.dashboard`, its page in the Louez dashboard.",
      "pathParams": [],
      "query": [
        {
          "name": "definitionId",
          "flag": "definition-id",
          "kind": "string",
          "description": "One variant only. Default: every variant."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "products_withdraw_variant",
      "group": "variants",
      "action": "withdraw",
      "method": "POST",
      "path": "/variants/{id}/withdraw",
      "summary": "Withdraw Variant from Products",
      "description": "Withdraws a variant from every product of the store at once: it is no longer one of their booking axes, their units lose their value for it, and their stock and bookings stop being split by it. The variant stays in the catalog. It asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview of the products it changes (their count, and the first 50). Returns `affectedProductCount`, how many products changed.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "products_create_variant_value",
      "group": "variants",
      "action": "create-value",
      "method": "POST",
      "path": "/variants/{definitionId}/values",
      "summary": "Add Variant Value",
      "description": "Adds a value to a variant, e.g. XL to Size: its `label` (1 to 100 characters) and, for a color variant, its swatch in `colorHex` (`#RRGGBB`). When the variant already has a value of that label, whatever its case, that value is returned with `created: false`, its color updated when one is sent. A variant holds at most 200 values (`VARIANT_VALUE_LIMIT_REACHED`). Returns the value.",
      "pathParams": [
        {
          "name": "definitionId",
          "flag": "definition-id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "label",
            "flag": "label",
            "kind": "string",
            "required": true
          },
          {
            "name": "colorHex",
            "flag": "color-hex",
            "kind": "string",
            "description": "For a color variant: the swatch, #RRGGBB."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_update_variant_value",
      "group": "variants",
      "action": "update-value",
      "method": "PATCH",
      "path": "/variants/values/{id}",
      "summary": "Update Variant Value",
      "description": "Renames a variant's value or changes its color. Send only the fields to change; `colorHex: null` clears the color. Refused with `VARIANT_VALUE_EXISTS` when the variant has another value of that label, whatever its case. Units that carry the former label keep it. Returns the value.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "label",
            "flag": "label",
            "kind": "string"
          },
          {
            "name": "colorHex",
            "flag": "color-hex",
            "kind": "string",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "products_delete_variant_value",
      "group": "variants",
      "action": "delete-value",
      "method": "DELETE",
      "path": "/variants/values/{id}",
      "summary": "Delete Variant Value",
      "description": "Deletes a value from a variant's catalog: it is no longer offered to products. Units that carry it keep it. It asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with a preview naming the products whose units carry it (their count, and the first 50). Returns the value's id.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "reservations_list",
      "group": "reservations",
      "action": "list",
      "method": "GET",
      "path": "/reservations",
      "summary": "List Reservations",
      "description": "Lists the store's reservations, by start date, newest first. Filter by `status` (by default, every open one), `period` (today, this week or this month, on the start date or, with `operation: return`, the end date), `paymentMethod` (with a key that can read payments) or `search` (part of the number, or of the customer's name with a key that can read customers); `sort` and `sortDirection` change the order. Returns up to `limit` reservations (25 by default, 100 at most), the count per status and the total that match. To read on, pass `nextCursor` back as `cursor` with the same filters and sort; it is null on the last page. Numbered pages (`page`) stop at the first 10,000 reservations. A reservation's lines, payments and history are in `GET /reservations/{id}`. Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [],
      "query": [
        {
          "name": "status",
          "flag": "status",
          "kind": "string",
          "enum": [
            "all",
            "pending",
            "confirmed",
            "ongoing",
            "completed",
            "cancelled",
            "rejected",
            "quote"
          ],
          "description": "Only this status. cancelled also covers rejected and declined. Default all, which leaves out cancelled, rejected and declined reservations unless `search` is set."
        },
        {
          "name": "period",
          "flag": "period",
          "kind": "string",
          "enum": [
            "today",
            "week",
            "month"
          ],
          "description": "Only reservations that start (or end, with operation return) today, this week (Monday to Sunday) or this month."
        },
        {
          "name": "operation",
          "flag": "operation",
          "kind": "string",
          "enum": [
            "departure",
            "return"
          ],
          "description": "Which date `period` reads: departure (the start, default) or return (the end)."
        },
        {
          "name": "paymentMethod",
          "flag": "payment-method",
          "kind": "string",
          "enum": [
            "cash",
            "card",
            "transfer",
            "check",
            "other",
            "stripe"
          ],
          "description": "Only reservations with a completed payment by this method. Needs read access to payments."
        },
        {
          "name": "search",
          "flag": "search",
          "kind": "string",
          "description": "Part of the reservation number, or of the customer's name (only when the connection may read customers)."
        },
        {
          "name": "sort",
          "flag": "sort",
          "kind": "string",
          "enum": [
            "startDate",
            "amount",
            "status",
            "number"
          ],
          "description": "startDate (default), amount (the total), status or number."
        },
        {
          "name": "sortDirection",
          "flag": "sort-direction",
          "kind": "string",
          "enum": [
            "asc",
            "desc"
          ],
          "description": "Default desc."
        },
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, with the same filters and sort. Leave it out for the first page."
        },
        {
          "name": "page",
          "flag": "page",
          "kind": "integer",
          "description": "A page number, for numbered pages (1 is the first); ignored when cursor is set. Use cursor to read further: through the API, page × limit stops at 10000."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Reservations per page, 100 at most, 25 by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_create",
      "group": "reservations",
      "action": "create",
      "method": "POST",
      "path": "/reservations",
      "summary": "Create Reservation",
      "description": "Creates a reservation of catalog products, picked up at the store's main location, as a `quote` (the customer accepts it; it takes no stock) or `confirmed` (its items leave the stock for these dates).\n\n- `customer` is `{ id }`, a customer of the store, or `{ email, firstName, lastName, phone? }`: a customer the store has with that e-mail is used as is and never changed (`customer.created: false`), else one is added. The key must read customers, and write them for the e-mail form.\n- Each line is priced as the online store's checkout prices the same cart: the catalog, the product's promotion, seasonal prices and the store's taxes, in the store's currency. No price is sent.\n- The store's booking rules (opening hours, notice, durations) come back in `warnings`, never as a refusal.\n- `notifyCustomer` is required: `true` queues the quote e-mail or the booking confirmation when the store sends that e-mail; the preview and `message` say whether one goes.\n- It requires an `Idempotency-Key`: the same key returns the first call's result and creates nothing more.\n\nA product that is not active, a missing required accessory (`details.missing`), or a consumable out of stock is refused. A booking the stock cannot cover answers `RESERVATION_INSUFFICIENT_CAPACITY` with `details.shortfalls`; lines short only with the turnover buffer answer `RESERVATION_TURNOVER_BUFFER_CONFLICT`. `allowOverbooking: true` and `overrideTurnoverBuffer: true` each pass only their own refusal.\n\nOn a key set to ask for confirmations (the default), a creation without either flag first answers 412 `CONFIRMATION_REQUIRED` with its preview. Sending either flag, even when nothing is short, is the key's owner's to approve. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with the preview and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer.\n\nCustom lines, prices or deposits typed by hand, discounts and promo codes, delivery, insurance and a pending status are the dashboard's: each answers `RESERVATION_OPTION_NOT_AVAILABLE` with `details.option`.\n\nReturns the reservation as `GET /reservations/{id}` does, `customer: { id, created }`, `capacity`, `message`, `warnings` and `links.dashboard`.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "customer",
            "flag": "customer",
            "kind": "json",
            "required": true,
            "description": "Either `{ id }`, a customer of this store, or `{ email, firstName, lastName, phone? }`: the customer with that e-mail if the store has one (its details are never changed), else a new customer."
          },
          {
            "name": "startDate",
            "flag": "start-date",
            "kind": "string",
            "required": true,
            "description": "When the rental starts: ISO 8601 with its offset."
          },
          {
            "name": "endDate",
            "flag": "end-date",
            "kind": "string",
            "required": true,
            "description": "When it ends, after the start: ISO 8601 with its offset."
          },
          {
            "name": "lines",
            "flag": "lines",
            "kind": "json",
            "required": true,
            "description": "The catalog products booked, each once or more."
          },
          {
            "name": "status",
            "flag": "status",
            "kind": "string",
            "enum": [
              "quote",
              "confirmed",
              "pending"
            ],
            "required": true,
            "description": "quote (sent to the customer to accept; it takes no stock) or confirmed (its items leave the stock for these dates). pending is refused: it is the customer's own checkout."
          },
          {
            "name": "notifyCustomer",
            "flag": "notify-customer",
            "kind": "boolean",
            "required": true,
            "description": "true sends the customer the quote e-mail (status quote) or the booking confirmation (status confirmed), when the store sends that e-mail; false sends nothing. Required."
          },
          {
            "name": "allowOverbooking",
            "flag": "allow-overbooking",
            "kind": "boolean",
            "description": "Refused with RESERVATION_INSUFFICIENT_CAPACITY: true creates it all the same, booking over the stock, for when the user chose to. It never passes a consumable out of stock, nor a shortfall the turnover buffer alone makes (that is overrideTurnoverBuffer)."
          },
          {
            "name": "overrideTurnoverBuffer",
            "flag": "override-turnover-buffer",
            "kind": "boolean",
            "description": "Refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock but not the turnover buffer the store keeps between rentals): true creates it all the same, for when the user chose a shorter turnaround. It never passes a line the stock itself cannot cover (that is allowOverbooking)."
          },
          {
            "name": "internalNotes",
            "flag": "internal-notes",
            "kind": "string",
            "description": "Notes only the store's team sees."
          },
          {
            "name": "customLines",
            "flag": "custom-lines",
            "kind": "json",
            "description": "Not taken by this version: lines that are not catalog products. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "depositOverride",
            "flag": "deposit-override",
            "kind": "string",
            "description": "Not taken by this version: a deposit typed by hand; the deposit is the products' own. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "discountAmount",
            "flag": "discount-amount",
            "kind": "string",
            "description": "Not taken by this version: a discount. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "promoCode",
            "flag": "promo-code",
            "kind": "string",
            "description": "Not taken by this version: a promo code. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "delivery",
            "flag": "delivery",
            "kind": "json",
            "description": "Not taken by this version: delivery; the customer picks up at the store's main location. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "insurance",
            "flag": "insurance",
            "kind": "boolean",
            "description": "Not taken by this version: insurance. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          },
          {
            "name": "tulipInsuranceOptIn",
            "flag": "tulip-insurance-opt-in",
            "kind": "boolean",
            "description": "Not taken by this version: insurance. Refused with RESERVATION_OPTION_NOT_AVAILABLE."
          }
        ]
      },
      "idempotent": true,
      "idempotencyRequired": true,
      "confirmation": true
    },
    {
      "id": "reservations_get",
      "group": "reservations",
      "action": "get",
      "method": "GET",
      "path": "/reservations/{id}",
      "summary": "Get Reservation",
      "description": "Returns one reservation with everything its dashboard page shows: status and dates, customer, lines with their products and assigned units, amounts and taxes, payments, deposit, delivery or pickup, insurance, notes, documents and history (newest first). Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_update",
      "group": "reservations",
      "action": "update",
      "method": "POST",
      "path": "/reservations/{id}",
      "summary": "Change Reservation Dates",
      "description": "Moves a reservation's dates. Only `startDate` and `endDate` change (ISO 8601 with an offset; an absent one keeps its stored value); its lines keep their products, quantities and assigned units, and its deposit and delivery stay as stored. Any other field is refused. Only a pending, quote, confirmed or ongoing reservation is changed (`RESERVATION_NOT_EDITABLE` otherwise); the end must come after the start, and an ongoing reservation's start cannot move (`RESERVATION_WINDOW_INVALID`).\n\nThe new prices come from the checkout's own pricing and the tax engine, and only when they give the reservation's stored prices back, to the cent, over its stored dates. When they do not (a promotion that ended, a price or a tax setting changed, a price typed by hand), and for an insured, discounted, marketplace or delivered reservation, or one whose extension checkout is open, the answer is `RESERVATION_EDIT_IN_DASHBOARD` with `details.reason`, and nothing changes: the change is made from the reservation's page in the dashboard.\n\nThe same dates as stored answer `changed: false` and write nothing. `notifyCustomer` is required: `true` queues the customer's “booking modified” e-mail with the change; it is refused with `RESERVATION_CUSTOMER_UNREACHABLE` when the customer has no e-mail address or the instance sends no e-mail.\n\nNew dates the stock cannot cover answer `RESERVATION_INSUFFICIENT_CAPACITY` with each short line; `allowOverbooking: true` moves them all the same. Lines that fit the stock but not the turnover buffer answer `RESERVATION_TURNOVER_BUFFER_CONFLICT`; `overrideTurnoverBuffer: true` passes them, for this change only. Neither passes `RESERVATION_UNITS_UNAVAILABLE`. Dates that stay inside the stored ones are never refused for the stock.\n\nOn a key set to ask for confirmations (the default), the change first answers 412 `CONFIRMATION_REQUIRED` with its preview. Sending either flag, even when nothing is short, is the key's owner's to approve. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with the preview and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer.\n\nNothing is charged or refunded. Returns the reservation as `GET /reservations/{id}` does, with `previousStartDate`, `previousEndDate`, `previousTotal` and `difference` in the reservation's currency, `warnings`, `capacity`, `customerMessage`, `changed` and `links.dashboard`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "startDate",
            "flag": "start-date",
            "kind": "string",
            "description": "The new start, ISO 8601 with its offset (2030-06-01T09:00:00+02:00, or Z). Absent: the start stays as it is. The start of an ongoing reservation cannot move: its goods are out."
          },
          {
            "name": "endDate",
            "flag": "end-date",
            "kind": "string",
            "description": "The new end, ISO 8601 with its offset. Absent: the end stays as it is. It must come after the start."
          },
          {
            "name": "notifyCustomer",
            "flag": "notify-customer",
            "kind": "boolean",
            "required": true,
            "description": "true: the customer gets the “booking modified” e-mail, with the previous and the new dates, at the address the preview names. Refused with RESERVATION_CUSTOMER_UNREACHABLE when the customer has no e-mail address or this instance sends no e-mail. false: no message. Required: always say which."
          },
          {
            "name": "allowOverbooking",
            "flag": "allow-overbooking",
            "kind": "boolean",
            "description": "For new dates the stock cannot cover (RESERVATION_INSUFFICIENT_CAPACITY): true moves them all the same, booking over the stock, and the reservation's history records the shortfalls. Send it only when the user chose to. It never passes a shortfall that comes from the turnover buffer alone (that is overrideTurnoverBuffer), a unit the reservation holds that another booking holds or needs (RESERVATION_UNITS_UNAVAILABLE), or a consumable out of stock."
          },
          {
            "name": "overrideTurnoverBuffer",
            "flag": "override-turnover-buffer",
            "kind": "boolean",
            "description": "For new dates refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock, not the turnover buffer the store keeps between rentals): true moves them all the same, for this change only. Send it only when the user chose to. It never passes a line the stock itself cannot cover (that is allowOverbooking)."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "reservations_poll",
      "group": "reservations",
      "action": "poll",
      "method": "GET",
      "path": "/reservations/counters",
      "summary": "Poll Reservation Changes",
      "description": "Counters cheap enough to poll: the requests waiting for an answer (with the five newest), the reservations per status, and the supplier invoices to handle. Each reservation listed comes with `links.dashboard`, its page in the Louez dashboard.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_list_calendar_period",
      "group": "reservations",
      "action": "list-calendar-period",
      "method": "GET",
      "path": "/reservations/calendar",
      "summary": "List Calendar Period",
      "description": "Lists the reservations that overlap a window, by start date, as the dashboard's calendar shows them: status, dates, amounts, customer, lines and delivery legs. `from` and `to` are ISO 8601 dates at most 400 days apart. Without `limit`, the answer holds the whole window; with one, pass `nextCursor` back as `cursor` to read on. Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [],
      "query": [
        {
          "name": "from",
          "flag": "from",
          "kind": "string",
          "required": true,
          "description": "Start of the window, ISO 8601. Reservations that end on or after it."
        },
        {
          "name": "to",
          "flag": "to",
          "kind": "string",
          "required": true,
          "description": "End of the window, ISO 8601, at most 400 days after from. Reservations that start on or before it."
        },
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, to read on. Without it, the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per page, at most 500. Without it, a page holds 100 over MCP and every item over the REST API."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_get_planning_timeline",
      "group": "reservations",
      "action": "get-planning-timeline",
      "method": "GET",
      "path": "/reservations/planning",
      "summary": "Get Planning Timeline",
      "description": "Returns the planning of a window: one entry per reservation and product, with the quantity, the assigned units and the delivery legs. `from` and `to` are ISO 8601 dates at most 400 days apart. Without `limit`, the answer holds the whole window; with one, pass `nextCursor` back as `cursor` to read on. Each entry comes with `links.dashboard`, its reservation's page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [],
      "query": [
        {
          "name": "from",
          "flag": "from",
          "kind": "string",
          "required": true,
          "description": "Start of the window, ISO 8601. Reservations that end on or after it."
        },
        {
          "name": "to",
          "flag": "to",
          "kind": "string",
          "required": true,
          "description": "End of the window, ISO 8601, at most 400 days after from. Reservations that start on or before it."
        },
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page, to read on. Without it, the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per page, at most 500. Without it, a page holds 100 over MCP and every item over the REST API."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_list_upcoming",
      "group": "reservations",
      "action": "list-upcoming",
      "method": "GET",
      "path": "/reservations/upcoming",
      "summary": "List Upcoming Pickups and Returns",
      "description": "Lists what is due from the start of today over the next `days` (7 by default, 1 for today only, 90 at most), soonest first: the confirmed reservations to hand over (`pickups`) and the ongoing ones due back (`returns`). Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [],
      "query": [
        {
          "name": "days",
          "flag": "days",
          "kind": "integer",
          "description": "Days to cover, counted from the start of today (1 = today only), 7 by default, 90 at most."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Rows per list, 200 at most, 50 by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_list_overdue",
      "group": "reservations",
      "action": "list-overdue",
      "method": "GET",
      "path": "/reservations/overdue",
      "summary": "List Overdue Reservations",
      "description": "Lists the late returns: ongoing reservations past their end date, the longest overdue first, with the number of days late. Each reservation, and its customer when shown, comes with `links.dashboard`: its page in the Louez dashboard. With a key that cannot read customers, the customer's name, email, addresses and notes are left out; with one that cannot read payments, so are the payment rows and Stripe ids (`rentalPaid` stays).",
      "pathParams": [],
      "query": [
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Rows per list, 200 at most, 50 by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "reservations_update_status",
      "group": "reservations",
      "action": "update-status",
      "method": "POST",
      "path": "/reservations/{id}/status",
      "summary": "Change Reservation Status",
      "description": "Changes a reservation's status, with the same effects as in the dashboard:\n\n- `confirmed` confirms a request or a quote: its items leave the stock and the customer gets the acceptance message. For a reservation with insurance, Louez then creates the insurance contract; a failure comes back in `warnings`, and the confirmation stands.\n- `rejected` rejects a request; the customer gets the rejection message, with `rejectionReason`.\n- `ongoing` marks it picked up. Refused with `CONTRACT_UNSIGNED` when the store requires a signed contract and the customer has not signed.\n- `completed` marks it returned.\n- `cancelled` cancels it, as `POST /reservations/{id}/cancel` does.\n\nThe customer's messages go out on the channels the store set for each. On a key set to ask for confirmations (the default), confirming a request or a quote without either flag below, rejecting and cancelling first answer 412 `CONFIRMATION_REQUIRED`, with a preview of the messages and the stock; on a key whose confirmations are off, they run at once.\n\nA confirmation the stock cannot cover answers `RESERVATION_INSUFFICIENT_CAPACITY`, with each short line in `details.shortfalls`. The same request with `allowOverbooking: true` confirms over the stock: its preview lists every shortfall, and the approval holds only while the shortfalls stay as previewed. Lines that fit the stock but not the turnover buffer the store keeps between rentals answer `RESERVATION_TURNOVER_BUFFER_CONFLICT`; `overrideTurnoverBuffer: true` passes it, for this confirmation only, with a preview of those lines and the buffer. Each flag passes only its own refusal, and neither passes `RESERVATION_UNITS_UNAVAILABLE` or a consumable out of stock.\n\nConfirming with either flag, even when nothing is short, is the key's owner's to approve. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with the preview and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer.\n\nReturns the change, the warnings the dashboard shows (opening hours, notice, durations, insurance), the customer messages that could not go out (`messagesNotSent`: an e-mail on an instance with no e-mail service, an SMS on one with no SMS provider, listed in the inbox) and the reservation's `links.dashboard`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "status",
            "flag": "status",
            "kind": "string",
            "enum": [
              "confirmed",
              "ongoing",
              "completed",
              "cancelled",
              "rejected"
            ],
            "required": true,
            "description": "confirmed (accept a request or a quote), ongoing (picked up), completed (returned), rejected (refuse a request) or cancelled."
          },
          {
            "name": "rejectionReason",
            "flag": "rejection-reason",
            "kind": "string",
            "description": "For a rejection: the customer reads it in the rejection email, and the reservation's history shows it."
          },
          {
            "name": "allowOverbooking",
            "flag": "allow-overbooking",
            "kind": "boolean",
            "description": "For a confirmation the stock cannot cover (RESERVATION_INSUFFICIENT_CAPACITY): true confirms it all the same, booking over the stock, and the reservation's history records the shortfalls. Send it only when the user chose to book over the stock. It covers only the units a line does not hold yet: a unit the reservation holds that another booking holds or needs refuses (RESERVATION_UNITS_UNAVAILABLE). It never passes consumable stock below zero, or a shortfall that comes from the turnover buffer alone (RESERVATION_TURNOVER_BUFFER_CONFLICT: that is overrideTurnoverBuffer); a line short on the stock itself is booked over whole, buffer included. Ignored for any other change."
          },
          {
            "name": "overrideTurnoverBuffer",
            "flag": "override-turnover-buffer",
            "kind": "boolean",
            "description": "For a confirmation refused with RESERVATION_TURNOVER_BUFFER_CONFLICT (lines that fit the stock, but not the turnover buffer the store keeps between rentals): true confirms those lines all the same, with less time between two rentals than the store set, and the reservation's history records them with the buffer. Send it only when the user chose to. It covers this confirmation only: nothing carries it to a later change. It never passes a line the stock itself cannot cover (RESERVATION_INSUFFICIENT_CAPACITY: that is allowOverbooking), a unit another booking holds or needs (RESERVATION_UNITS_UNAVAILABLE), or a consumable out of stock. A reservation short both ways needs both flags. Ignored for any other change."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "reservations_cancel",
      "group": "reservations",
      "action": "cancel",
      "method": "POST",
      "path": "/reservations/{id}/cancel",
      "summary": "Cancel Reservation",
      "description": "Cancels a reservation that is not over (pending, quote, confirmed or ongoing): its items go back to the stock and the customer gets the cancellation message on the channels the store set. If the reservation has an insurance contract, Louez asks the insurer to cancel it; if that fails, the reservation is cancelled all the same and the answer does not say so. Nothing is refunded or released, and the message does not mention a refund. On a key set to ask for confirmations (the default), it first answers 412 `CONFIRMATION_REQUIRED`, with a preview of the customer, the dates, what was paid and the message; on a key whose confirmations are off, it runs at once. Returns the change and the reservation's `links.dashboard`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "reservations_update_notes",
      "group": "reservations",
      "action": "update-notes",
      "method": "PATCH",
      "path": "/reservations/{id}/notes",
      "summary": "Update Reservation Notes",
      "description": "Replaces a reservation's internal notes, which only the store's team sees; an empty string clears them. Returns the notes and the reservation's `links.dashboard`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "required": true,
            "description": "The new internal notes; an empty string clears them."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "online_store_update",
      "group": "online-store",
      "action": "update",
      "method": "PATCH",
      "path": "/online-store",
      "summary": "Update Online Store",
      "description": "Saves sections of the online store editor in one write. Each section sent replaces what it covers; a section left out stays as it is:\n\n- `identity`: the name, the tagline and the description as HTML, the storefront's language, the logos and favicon, the theme and brand colour.\n- `home`: the banner photos (5 at most) and their layout, whether the home page lists products or categories first, the largest discount percent the product cards show, the announcement bar and the home sections (map, reviews, reassurance).\n- `contact`: email, phone, address and coordinates, the contact page's channels, the social links and whether the header shows the phone.\n- `legal`: the terms, the legal notice, whether the contract includes the full terms, and the footer note.\n- `seo`: the Google site verification and the share image.\n\nHTML is sanitised on save; HTML nested too deep answers `TEXT_TOO_DEEP`, and a text too long once saved `TEXT_TOO_LONG`. An image must be one the store uploaded (`POST /online-store/images`, or `POST /online-store/image-uploads` then `POST /online-store/image-uploads/complete`); another URL is refused with `IMAGE_NOT_OWNED`. To change a few fields, `PATCH /settings/store-info`, `PATCH /settings/legal` and `PATCH /online-store/appearance` take only those.\n\nReturns `success: true`. `links.dashboard` is the online store editor; once the store is online, `links.storefront` is its storefront.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "identity",
            "flag": "identity",
            "kind": "json"
          },
          {
            "name": "home",
            "flag": "home",
            "kind": "json"
          },
          {
            "name": "contact",
            "flag": "contact",
            "kind": "json"
          },
          {
            "name": "legal",
            "flag": "legal",
            "kind": "json"
          },
          {
            "name": "seo",
            "flag": "seo",
            "kind": "json"
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "online_store_check_slug_availability",
      "group": "online-store",
      "action": "check-slug-availability",
      "method": "GET",
      "path": "/online-store/slug-availability",
      "summary": "Check Store Address Availability",
      "description": "Says whether the store can move to another web address (its slug), before `POST /online-store/slug`. Returns `available`; `current: true` when it is the store's address already; the `reason` it cannot be used (`taken`, `reserved` or `invalid`); and up to three free `suggestions` close to it. `slug` may also be a name: the suggestions are built from it. A slug is 3 to 50 lowercase letters, digits and hyphens.",
      "pathParams": [],
      "query": [
        {
          "name": "slug",
          "flag": "slug",
          "kind": "string",
          "required": true,
          "description": "The web address to check. A name works too: suggestions come from it."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "online_store_update_slug",
      "group": "online-store",
      "action": "update-slug",
      "method": "POST",
      "path": "/online-store/slug",
      "summary": "Change Store Address",
      "description": "Moves the store to a new web address (its slug: 3 to 50 lowercase letters, digits and hyphens): the storefront's public URL changes and Louez keeps no redirect, so links to the old address stop working once the store is online. The store's current address is refused with `STORE_SLUG_UNCHANGED`, and an address another store has with `STORE_SLUG_TAKEN`, with free ones close to it in `details.suggestions`. On a key that asks for confirmations, it asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), with a preview of the old and the new URL and whether the store is online. Returns the new and the previous slug, the storefront's new `storefrontUrl`, `oldLinksRedirect: false` and `links`: the online store editor and, once the store is online, its storefront at the new address.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "slug",
            "flag": "slug",
            "kind": "string",
            "required": true,
            "description": "The store's web address: 3 to 50 lowercase letters, digits and hyphens. Check it first with online_store_check_slug_availability."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "online_store_update_appearance",
      "group": "online-store",
      "action": "update-appearance",
      "method": "PATCH",
      "path": "/online-store/appearance",
      "summary": "Update Storefront Appearance",
      "description": "Changes how the storefront looks: light or dark theme, brand colour (#RRGGBB), logo, dark logo, favicon, the home page's banner photos (5 at most, in order) and their layout, and whether the home page lists products or categories first. Send only the fields to change; null removes an image, and `heroImages: []` removes the banner photos. An image must be one the store uploaded (`POST /online-store/images`, or `POST /online-store/image-uploads` then `POST /online-store/image-uploads/complete`); another URL is refused with `IMAGE_NOT_OWNED`. Returns the whole look. `links.dashboard` is the online store editor; once the store is online, `links.storefront` is its storefront.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "mode",
            "flag": "mode",
            "kind": "string",
            "enum": [
              "light",
              "dark"
            ],
            "description": "The storefront's light or dark theme."
          },
          {
            "name": "primaryColor",
            "flag": "primary-color",
            "kind": "string",
            "description": "The brand colour of buttons and links, as #RRGGBB."
          },
          {
            "name": "logoUrl",
            "flag": "logo-url",
            "kind": "string",
            "nullable": true,
            "description": "The logo; null removes it."
          },
          {
            "name": "darkLogoUrl",
            "flag": "dark-logo-url",
            "kind": "string",
            "nullable": true,
            "description": "The logo shown on a dark background; null removes it."
          },
          {
            "name": "faviconUrl",
            "flag": "favicon-url",
            "kind": "string",
            "nullable": true,
            "description": "The browser tab icon; null removes it."
          },
          {
            "name": "heroImages",
            "flag": "hero-images",
            "kind": "string",
            "list": true,
            "description": "The home page's banner photos, in order, 5 at most; [] removes them."
          },
          {
            "name": "heroLayout",
            "flag": "hero-layout",
            "kind": "string",
            "enum": [
              "cover",
              "split"
            ],
            "description": "cover: the photo fills the banner behind the text; split: text and photo side by side."
          },
          {
            "name": "heroAlign",
            "flag": "hero-align",
            "kind": "string",
            "enum": [
              "start",
              "center",
              "end"
            ],
            "description": "Where the banner text sits."
          },
          {
            "name": "heroVerticalAlign",
            "flag": "hero-vertical-align",
            "kind": "string",
            "enum": [
              "start",
              "center",
              "end"
            ]
          },
          {
            "name": "catalogBrowseMode",
            "flag": "catalog-browse-mode",
            "kind": "string",
            "enum": [
              "products",
              "categories"
            ],
            "description": "Whether the home page lists products or categories first."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "online_store_create_image_upload",
      "group": "online-store",
      "action": "create-image-upload",
      "method": "POST",
      "path": "/online-store/image-uploads",
      "summary": "Start Storefront Image Upload",
      "description": "Starts the upload of a storefront image. `kind` is `logo` for a logo, the dark logo or the favicon (2 MB at most) and `hero` for a banner photo of the home page (5 MB at most); the file is JPEG, PNG, GIF or WebP. Send `kind`, the `contentType` and the `size` in bytes; a size over the kind's limit answers `UPLOAD_TOO_LARGE`. The upload takes three requests:\n\n1. This one returns a `key`, an `upload` and its `expiresAt`, 10 minutes from now.\n2. Send the file's bytes in the one request `upload` describes, without the `Authorization` header and before `expiresAt`: with `upload.method` PUT, the bytes as the body of a PUT to `upload.url` with `upload.headers`, its `Content-Type` included; with POST, a `multipart/form-data` POST to `upload.url` with `upload.fields` first, then the file as `file`.\n3. `POST /online-store/image-uploads/complete` with the same `kind` and the `key` checks the file and returns its public `url`.\n\nEach call issues a new upload. `POST /online-store/images` uploads an image in one request instead.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "kind",
            "flag": "kind",
            "kind": "string",
            "enum": [
              "logo",
              "hero"
            ],
            "required": true,
            "description": "logo: a logo or the favicon (2 MB at most); hero: a banner photo of the home page."
          },
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "required": true,
            "description": "The image's type. Send the bytes with exactly this Content-Type."
          },
          {
            "name": "size",
            "flag": "size",
            "kind": "integer",
            "required": true,
            "description": "The file's size in bytes."
          }
        ]
      },
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "online_store_complete_image_upload",
      "group": "online-store",
      "action": "complete-image-upload",
      "method": "POST",
      "path": "/online-store/image-uploads/complete",
      "summary": "Complete Storefront Image Upload",
      "description": "Finishes a storefront image upload started with `POST /online-store/image-uploads`, once its file was sent: with the same `kind` and the `key`, checks the file (its size, and that its bytes are an image of the declared type), makes it publicly readable and returns its `url`, its type and its size. `PATCH /online-store/appearance` takes that `url` (`logoUrl`, `darkLogoUrl`, `faviconUrl` or `heroImages`). It changes nothing on the storefront. A key that is not a storefront upload of the store answers `UPLOAD_NOT_OWNED`; a key with no file sent yet, `UPLOAD_NOT_FOUND`. A file over the kind's limit (`UPLOAD_TOO_LARGE`) or whose bytes are not an image of the declared type (`UPLOAD_CONTENT_INVALID`) is refused and stays private: start over with a new upload. Completing the same key again returns the same answer.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "kind",
            "flag": "kind",
            "kind": "string",
            "enum": [
              "logo",
              "hero"
            ],
            "required": true,
            "description": "logo: a logo or the favicon (2 MB at most); hero: a banner photo of the home page."
          },
          {
            "name": "key",
            "flag": "key",
            "kind": "string",
            "required": true,
            "description": "The key online_store_create_image_upload returned."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "online_store_upload_image",
      "group": "online-store",
      "action": "upload-image",
      "method": "POST",
      "path": "/online-store/images",
      "summary": "Upload Storefront Image",
      "description": "Uploads a storefront image in one request. `kind` is `logo` for a logo, the dark logo or the favicon (2 MB at most) and `hero` for a banner photo of the home page (5 MB at most); the file is JPEG, PNG, GIF or WebP. Send `kind` and exactly one of `contentBase64`, the file's bytes in base64 (or a `data:image/…;base64,` URL), and `imageUrl`, a public HTTPS URL Louez downloads; both or neither answers `UPLOAD_SOURCE_INVALID`. The type is read from the bytes: with `contentBase64`, a `contentType` that does not match them answers `UPLOAD_CONTENT_INVALID`; with `imageUrl`, the type is only detected from the bytes downloaded. Bytes that are no such image answer `UPLOAD_CONTENT_INVALID`, and text that is not base64 answers `UPLOAD_BASE64_INVALID`. A URL that does not answer 200 with the image, needs more than 3 redirects, takes more than 10 seconds on one of its requests, is not HTTPS or points to a private or local address answers `UPLOAD_URL_UNREACHABLE`; while too many images are being downloaded, `UPLOAD_IMPORT_BUSY` (429, retry a few seconds later). An image over the kind's limit answers `UPLOAD_TOO_LARGE`. Each call stores a new image and changes nothing on the storefront. Returns the image's public `url`, with its key, type and size: `PATCH /online-store/appearance` takes that `url` (`logoUrl`, `darkLogoUrl`, `faviconUrl` or `heroImages`).",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "contentBase64",
            "flag": "content-base64",
            "kind": "string",
            "description": "The file's bytes, base64 (or a data:image/…;base64, URL), 5 MB at most once decoded. Use it when you cannot reach an upload URL, e.g. for an image you made in your own workspace."
          },
          {
            "name": "contentType",
            "flag": "content-type",
            "kind": "string",
            "enum": [
              "image/jpeg",
              "image/png",
              "image/gif",
              "image/webp"
            ],
            "description": "The type of the bytes in contentBase64, when you know it; the bytes must match it."
          },
          {
            "name": "imageUrl",
            "flag": "image-url",
            "kind": "string",
            "description": "A public HTTPS URL of the image instead of its bytes. Louez downloads it; private or local addresses are refused."
          },
          {
            "name": "kind",
            "flag": "kind",
            "kind": "string",
            "enum": [
              "logo",
              "hero"
            ],
            "required": true,
            "description": "logo: a logo or the favicon (2 MB at most); hero: a banner photo of the home page."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "search_global",
      "group": "search",
      "action": "global",
      "method": "GET",
      "path": "/search",
      "summary": "Search Store",
      "description": "Searches the store at once, as the dashboard's search bar does, for `query` (1 to 100 characters, matched anywhere in the field). Returns up to 5 products by name, A to Z; up to 5 reservations by number, or by the customer's name or company with a key that can read customers, newest first; and up to 5 customers by name, company, email, phone or a searchable custom field the store has not flagged sensitive, newest first. With a key that cannot read products, `products` comes back empty; with one that cannot read customers, so does `customers`, and each reservation's `customerName` is null. Each hit comes with `links.dashboard`, its page in the Louez dashboard.",
      "pathParams": [],
      "query": [
        {
          "name": "query",
          "flag": "query",
          "kind": "string",
          "required": true,
          "description": "Part of a name, number, email or phone."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "get_dashboard_stats",
      "group": "statistics",
      "action": "get-dashboard-stats",
      "method": "GET",
      "path": "/analytics/dashboard",
      "summary": "Get Dashboard Stats",
      "description": "Returns the figures of the dashboard's home, computed at the time of the call: today's revenue, departures (confirmed reservations that start today) and returns (ongoing reservations due back today); the revenue since the first of the month, over the previous month and since the store opened; the reservations by status; the products and the customers. Revenue is the rental payments received: completed rental payments of every method (card, cash, transfer…), counted on the day they were cashed in; deposits and refunds are left out. Today and the month follow the store's time zone, returned as `timezone`. Amounts are decimal strings in the store's current `currency`. Payments in another currency (taken before the store changed currency) are left out of them and listed per currency in `otherCurrencies`. Takes no parameter, and refuses `period`: the figures over a period are in `GET /analytics/revenue` and `GET /analytics/products`. Storefront visits are not counted. `links.dashboard` is the dashboard's home.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "get_revenue_report",
      "group": "statistics",
      "action": "get-revenue-report",
      "method": "GET",
      "path": "/analytics/revenue",
      "summary": "Get Revenue Report",
      "description": "Returns the store's revenue over a window, as the dashboard's sales page shows it: the total and its change in percent against the window of the same length right before, the number of payments and their average, the split by payment method, and the revenue per day (per month for a window longer than 92 days). Revenue is the rental payments received: completed rental payments of every method (card, cash, transfer…), counted on the day they were cashed in; deposits and refunds are left out. Also counts the reservations that start over the window (pending, confirmed, ongoing or completed), with their change. Takes a rolling `period` of the dashboard's filter (7d, 30d, 90d, 6m or 12m; default 30d) or a custom range of whole days, startDate to endDate included, 731 days at most. Days start at midnight in the store's time zone, and a window ends at the time of the call at the latest, so today counts up to now. `window` returns the bounds used. Amounts are decimal strings in the store's current `currency`. Payments in another currency (taken before the store changed currency) are left out of them and listed per currency in `otherCurrencies`. `links.dashboard` is the sales page.",
      "pathParams": [],
      "query": [
        {
          "name": "period",
          "flag": "period",
          "kind": "string",
          "enum": [
            "7d",
            "30d",
            "90d",
            "6m",
            "12m"
          ],
          "description": "A rolling period of the dashboard's filter, ending now: 7d, 30d and 90d start at midnight 6, 29 and 89 days ago; 6m and 12m start on the first day of the month 5 and 11 months ago. Default 30d. Leave it out when you send startDate and endDate."
        },
        {
          "name": "startDate",
          "flag": "start-date",
          "kind": "string",
          "description": "First day of a custom range, YYYY-MM-DD, in the store's time zone. Send it with endDate."
        },
        {
          "name": "endDate",
          "flag": "end-date",
          "kind": "string",
          "description": "Last day of a custom range, YYYY-MM-DD, included, in the store's time zone. A range ends at the time of the call at the latest."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "get_product_performance",
      "group": "statistics",
      "action": "get-product-performance",
      "method": "GET",
      "path": "/analytics/products",
      "summary": "Get Product Performance",
      "description": "Ranks the store's products by revenue over a window, as the top products table of the dashboard's sales page does: each reservation's payments received over the window are split across its items in proportion to their price, and each product gets its share, with the units booked and the number of reservations behind it. Revenue is the rental payments received: completed rental payments of every method (card, cash, transfer…), counted on the day they were cashed in; deposits and refunds are left out. Returns the `limit` best products (10 by default, 50 at most), how many products brought revenue, and the window's revenue with the parts that went to the products, to items outside the catalog and to reservations without priced items. Takes a rolling `period` of the dashboard's filter (7d, 30d, 90d, 6m or 12m; default 30d) or a custom range of whole days, startDate to endDate included, 731 days at most. Days start at midnight in the store's time zone, and a window ends at the time of the call at the latest, so today counts up to now. Amounts are decimal strings in the store's current `currency`. Payments in another currency (taken before the store changed currency) are left out of them and listed per currency in `otherCurrencies`. Storefront views are not counted. Each product comes with `links.dashboard`, its page in the dashboard, and `links.storefront` when it is active and the store is online; the answer's own `links.dashboard` is the sales page.",
      "pathParams": [],
      "query": [
        {
          "name": "period",
          "flag": "period",
          "kind": "string",
          "enum": [
            "7d",
            "30d",
            "90d",
            "6m",
            "12m"
          ],
          "description": "A rolling period of the dashboard's filter, ending now: 7d, 30d and 90d start at midnight 6, 29 and 89 days ago; 6m and 12m start on the first day of the month 5 and 11 months ago. Default 30d. Leave it out when you send startDate and endDate."
        },
        {
          "name": "startDate",
          "flag": "start-date",
          "kind": "string",
          "description": "First day of a custom range, YYYY-MM-DD, in the store's time zone. Send it with endDate."
        },
        {
          "name": "endDate",
          "flag": "end-date",
          "kind": "string",
          "description": "Last day of a custom range, YYYY-MM-DD, included, in the store's time zone. A range ends at the time of the call at the latest."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Products to rank, 10 by default, 50 at most."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "partners_list",
      "group": "partners",
      "action": "list",
      "method": "GET",
      "path": "/partners",
      "summary": "List Partners",
      "description": "Returns the store's partners with their commission rule and their figures for a month (`month`, YYYY-MM, the current one by default): bookings, `due`, `paid`, `remaining`, `upcoming` and visits through their link. Amounts are in `currency`, rounded to its minor unit. A commission is computed on the rental after discount, without deposit, delivery or insurance; it is `upcoming` until the rental ends, `due` once completed or past its end, `cancelled` with the reservation. The store pays its partners itself: `paid` is what it recorded.",
      "pathParams": [],
      "query": [
        {
          "name": "month",
          "flag": "month",
          "kind": "string",
          "description": "The month to sum up, YYYY-MM, in the store's time zone. Defaults to the current one."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "partners_get_statement",
      "group": "partners",
      "action": "get-statement",
      "method": "GET",
      "path": "/partners/{partnerId}/statement",
      "summary": "Get Partner Statement",
      "description": "Returns a partner's statement for a month (`month`, YYYY-MM, the current one by default): its reservations with dates, rental base, commission, adjustment and state, the month's totals and the recorded payments. Amounts are in `currency`, rounded to its minor unit. A commission is computed on the rental after discount, without deposit, delivery or insurance; it is `upcoming` until the rental ends, `due` once completed or past its end, `cancelled` with the reservation. The store pays its partners itself: `paid` is what it recorded.",
      "pathParams": [
        {
          "name": "partnerId",
          "flag": "partner-id",
          "kind": "string",
          "required": true,
          "description": "The partner's id, from partners_list."
        }
      ],
      "query": [
        {
          "name": "month",
          "flag": "month",
          "kind": "string",
          "description": "The month, YYYY-MM: the month the rentals end in. Defaults to the current one."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "settings_get",
      "group": "settings",
      "action": "get",
      "method": "GET",
      "path": "/settings",
      "summary": "Get Store Settings",
      "description": "Returns everything the store is set up with: its info and contact (`store`), the company (country, time zone, currency, billing address), the legal texts, the storefront (web address, URL, tagline, language, appearance), the reservation rules, the business hours and closures, delivery, the pickup points (`locations`), taxes, and whether Stripe takes payments. The terms and the legal notice come as a summary, whether each is set and its length; `includeLegalTexts=true` adds their full text, up to 100,000 characters each. Each section is changed by its own `PATCH /settings/…` operation, which takes the field names shown here (the legal texts as `cgv` and `legalNotice`). `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home. Each pickup point and the storefront come with their own `links`.",
      "pathParams": [],
      "query": [
        {
          "name": "includeLegalTexts",
          "flag": "include-legal-texts",
          "kind": "boolean",
          "description": "true returns the full terms and legal notice (up to 100,000 characters each). Left out, they come as a summary: whether each is set and its length."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "settings_update_store_info",
      "group": "settings",
      "action": "update-store-info",
      "method": "PATCH",
      "path": "/settings/store-info",
      "summary": "Update Store Information",
      "description": "Changes the store's name, description and contact details (`email`, `phone`, `address`, `latitude`, `longitude`), as the storefront shows them. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. A null clears a field. Send `latitude` and `longitude` with a new address: delivery distances are measured from them. The description takes plain text (blank lines make paragraphs) or simple HTML, sanitised before it is saved. Plain text is fine; a `<` then a letter, later closed by `>`, reads as HTML, so to keep a literal < or > write it as &lt; or &gt;. A text too long once saved as HTML is refused with `TEXT_TOO_LONG`, one nested too deep with `TEXT_TOO_DEEP`. Returns the store info. `links.dashboard` is the identity page of the online store editor; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "description": "The store's name, as customers see it."
          },
          {
            "name": "description",
            "flag": "description",
            "kind": "string",
            "nullable": true,
            "description": "What the store rents, shown on the storefront. Plain text or simple HTML; null clears it. Plain text is fine; a `<` then a letter, later closed by `>`, reads as HTML, so to keep a literal < or > write it as &lt; or &gt;."
          },
          {
            "name": "email",
            "flag": "email",
            "kind": "string",
            "nullable": true,
            "description": "Contact e-mail shown to customers; null clears it."
          },
          {
            "name": "phone",
            "flag": "phone",
            "kind": "string",
            "nullable": true,
            "description": "Contact phone shown to customers, in international format (+33…); null clears it."
          },
          {
            "name": "address",
            "flag": "address",
            "kind": "string",
            "nullable": true,
            "description": "The store's postal address, on one line; null clears it."
          },
          {
            "name": "latitude",
            "flag": "latitude",
            "kind": "number",
            "nullable": true
          },
          {
            "name": "longitude",
            "flag": "longitude",
            "kind": "number",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_update_company",
      "group": "settings",
      "action": "update-company",
      "method": "PATCH",
      "path": "/settings/company",
      "summary": "Update Company Details",
      "description": "Changes the company's country, the currency and the billing address printed on contracts and invoices. The country sets the store's time zone, which every date and opening hour follows. New reservations use the new currency for their prices, deposits and payments. A currency Louez does not take is refused with `CURRENCY_NOT_SUPPORTED`, unless it is the store's current one sent back unchanged. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. A new country or currency asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview; the billing address alone is saved directly. Returns the company settings. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "country",
            "flag": "country",
            "kind": "string",
            "enum": [
              "AT",
              "BE",
              "CH",
              "CZ",
              "DE",
              "DK",
              "ES",
              "FI",
              "FR",
              "GB",
              "GR",
              "HR",
              "HU",
              "IE",
              "IT",
              "LU",
              "MC",
              "NL",
              "NO",
              "PL",
              "PT",
              "RO",
              "SE",
              "CA",
              "MX",
              "US",
              "AR",
              "BR",
              "CL",
              "CO",
              "AU",
              "CN",
              "HK",
              "IN",
              "JP",
              "KR",
              "MY",
              "NZ",
              "PH",
              "SG",
              "TH",
              "TW",
              "VN",
              "AE",
              "IL",
              "MA",
              "SA",
              "ZA"
            ],
            "description": "Where the company is. It sets the store's time zone, which every date and opening hour follows."
          },
          {
            "name": "currency",
            "flag": "currency",
            "kind": "string",
            "description": "The currency of every price, deposit and payment, among EUR, GBP, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON, USD, CAD, MXN, BRL, ARS, CLP, COP, AUD, NZD, JPY, CNY, INR, SGD, HKD, KRW, TWD, THB, MYR, PHP, VND, AED, SAR, ILS, ZAR, MAD. Existing reservations keep their own. A store set up in a currency no longer on the list may send it back unchanged."
          },
          {
            "name": "billingAddress",
            "flag": "billing-address",
            "kind": "json",
            "description": "The address printed on contracts and invoices: { sameAsStore: true }, or { sameAsStore: false, address, city, postalCode, country }."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "settings_update_legal",
      "group": "settings",
      "action": "update-legal",
      "method": "PATCH",
      "path": "/settings/legal",
      "summary": "Update Legal Texts",
      "description": "Changes the store's legal texts: the terms and conditions (`cgv`), the legal notice (`legalNotice`), whether the full terms are printed in every rental contract (`includeCgvInContract`), and the plain-text note at the bottom of the storefront's footer (`footerNote`, 500 characters at most). Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. A null or blank text clears it. The terms and the legal notice take plain text (blank lines make paragraphs) or simple HTML, 100,000 characters at most, sanitised before they are saved. Plain text is fine; a `<` then a letter, later closed by `>`, reads as HTML, so to keep a literal < or > write it as &lt; or &gt;. A text too long once saved as HTML is refused with `TEXT_TOO_LONG`, one nested too deep with `TEXT_TOO_DEEP`. `GET /settings?includeLegalTexts=true` returns the current texts. Returns the legal texts as saved, in HTML. `links.dashboard` is the legal page of the online store editor; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "cgv",
            "flag": "cgv",
            "kind": "string",
            "nullable": true,
            "description": "Terms and conditions (CGV): plain text or simple HTML; null clears them. Plain text is fine; a `<` then a letter, later closed by `>`, reads as HTML, so to keep a literal < or > write it as &lt; or &gt;."
          },
          {
            "name": "legalNotice",
            "flag": "legal-notice",
            "kind": "string",
            "nullable": true,
            "description": "Legal notice (mentions légales): plain text or simple HTML; null clears it. Plain text is fine; a `<` then a letter, later closed by `>`, reads as HTML, so to keep a literal < or > write it as &lt; or &gt;."
          },
          {
            "name": "includeCgvInContract",
            "flag": "include-cgv-in-contract",
            "kind": "boolean",
            "description": "Print the full terms in every rental contract."
          },
          {
            "name": "footerNote",
            "flag": "footer-note",
            "kind": "string",
            "nullable": true,
            "description": "Plain text at the bottom of the storefront footer (company id, accreditation); null clears it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_update_reservation_rules",
      "group": "settings",
      "action": "update-reservation-rules",
      "method": "PATCH",
      "path": "/settings/reservation-rules",
      "summary": "Update Reservation Rules",
      "description": "Changes how customers book: the booking mode (`payment`: paid online at checkout; `request`: a request the store accepts or declines), whether an unanswered request already holds the stock, the share paid online (10 to 100 percent), the shortest and longest rental, the notice before a rental starts, the buffer after each return (a week at most), whether checkout asks for the customer's address, extensions, and whether the contract must be signed before pickup (`contractSignatureMode`). Durations are in minutes, a year at most. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. Refused with `SETTINGS_INVALID` when the shortest rental would be longer than the longest, and with `STRIPE_REQUIRED` when switching to `payment` while the store's Stripe account does not take charges. A change of the booking mode or of the share paid online asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview. Returns the rules. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "reservationMode",
            "flag": "reservation-mode",
            "kind": "string",
            "enum": [
              "payment",
              "request"
            ],
            "description": "payment: customers pay online when they book (needs Stripe connected). request: customers send a request the store accepts or declines, and pay later."
          },
          {
            "name": "pendingBlocksAvailability",
            "flag": "pending-blocks-availability",
            "kind": "boolean",
            "description": "In request mode: whether an unanswered request already holds the stock."
          },
          {
            "name": "onlinePaymentDepositPercentage",
            "flag": "online-payment-deposit-percentage",
            "kind": "integer",
            "description": "In payment mode: the share of the rental paid at booking, 10 to 100; the rest is paid at pickup."
          },
          {
            "name": "minRentalMinutes",
            "flag": "min-rental-minutes",
            "kind": "integer",
            "description": "Shortest rental, in minutes; 0 for none."
          },
          {
            "name": "maxRentalMinutes",
            "flag": "max-rental-minutes",
            "kind": "integer",
            "nullable": true,
            "description": "Longest rental, in minutes; null for no limit."
          },
          {
            "name": "advanceNoticeMinutes",
            "flag": "advance-notice-minutes",
            "kind": "integer",
            "description": "How long before its start a rental may be booked, in minutes (1440 = a day)."
          },
          {
            "name": "turnoverBufferMinutes",
            "flag": "turnover-buffer-minutes",
            "kind": "integer",
            "description": "Time after each return before the item can go out again, in minutes, a week at most."
          },
          {
            "name": "requireCustomerAddress",
            "flag": "require-customer-address",
            "kind": "boolean",
            "description": "Ask customers for their postal address at checkout."
          },
          {
            "name": "automaticExtensions",
            "flag": "automatic-extensions",
            "kind": "boolean",
            "description": "Let customers extend a rental from their account."
          },
          {
            "name": "maxExtensionDays",
            "flag": "max-extension-days",
            "kind": "integer",
            "nullable": true,
            "description": "Longest extension a customer may ask, in days; null for no limit."
          },
          {
            "name": "contractSignatureMode",
            "flag": "contract-signature-mode",
            "kind": "string",
            "enum": [
              "optional",
              "recommended",
              "required"
            ],
            "description": "Marking a rental picked up while the customer has not signed the contract. optional: allowed. recommended: allowed, after a warning. required: refused until they sign."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "settings_update_business_hours",
      "group": "settings",
      "action": "update-business-hours",
      "method": "PATCH",
      "path": "/settings/business-hours",
      "summary": "Update Business Hours",
      "description": "Changes the opening hours and closures; with `enabled: true`, pickups and returns are only offered within them, and with `enabled: false` the store takes bookings at any time. `schedule` names the days to change (`monday` … `sunday`), each with `isOpen` and up to 4 `ranges` of `openTime` and `closeTime` (HH:mm, in the store's time zone); days left out stay as they are. `closurePeriods` replaces every closure, 200 at most: send the current ones, as `GET /settings` returns them with their `id`, along with your change to keep them. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. Returns the hours. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "enabled",
            "flag": "enabled",
            "kind": "boolean",
            "description": "false: the store takes bookings at any time; true: only within the hours below."
          },
          {
            "name": "schedule",
            "flag": "schedule",
            "kind": "json",
            "description": "Days to change, by name: { \"monday\": { \"isOpen\": true, \"ranges\": [{ \"openTime\": \"09:00\", \"closeTime\": \"12:00\" }, { \"openTime\": \"14:00\", \"closeTime\": \"18:00\" }] } }. Times are HH:mm in the store's time zone; days left out stay as they are."
          },
          {
            "name": "closurePeriods",
            "flag": "closure-periods",
            "kind": "json",
            "description": "Replaces every closure (holidays, events): { name, startDate, endDate } as YYYY-MM-DD, both included, with startTime and endTime (HH:mm) for part of a day. Send the current list with your change to keep the others."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_update_delivery",
      "group": "settings",
      "action": "update-delivery",
      "method": "PATCH",
      "path": "/settings/delivery",
      "summary": "Update Delivery Settings",
      "description": "Changes delivery to the customer's address: on or off (`enabled`), its `mode` (`optional`: the customer chooses pickup or delivery; `required`: outbound delivery is mandatory; `included`: mandatory and free), the fee per kilometre, the lowest fee per leg, the farthest distance (`maximumDistanceKm`, 1 to 500, null for no limit), the order amount from which it is free, the smallest order delivered, and whether customers may choose one of the store's active pickup points (`multiLocationEnabled`). Amounts are decimal strings in the store's currency, such as `\"1.50\"`. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. Distances are measured from the store: while delivery is on, a store without coordinates is refused with `STORE_COORDINATES_REQUIRED` (`PATCH /settings/store-info` sets them). Any change asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview. Returns the delivery settings. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "enabled",
            "flag": "enabled",
            "kind": "boolean",
            "description": "Offer delivery to the customer's address. Needs the store's coordinates (settings_update_store_info)."
          },
          {
            "name": "mode",
            "flag": "mode",
            "kind": "string",
            "enum": [
              "optional",
              "required",
              "included"
            ],
            "description": "optional: the customer picks pickup or delivery; required: outbound delivery is mandatory; included: mandatory and free."
          },
          {
            "name": "multiLocationEnabled",
            "flag": "multi-location-enabled",
            "kind": "boolean",
            "description": "Let customers pick one of the store's active pickup points."
          },
          {
            "name": "pricePerKm",
            "flag": "price-per-km",
            "kind": "string",
            "description": "Fee per kilometre, in the store's currency."
          },
          {
            "name": "minimumFee",
            "flag": "minimum-fee",
            "kind": "string",
            "description": "Lowest fee for each leg, whatever the distance."
          },
          {
            "name": "maximumDistanceKm",
            "flag": "maximum-distance-km",
            "kind": "number",
            "nullable": true,
            "description": "Farthest delivery, in kilometres; null for no limit."
          },
          {
            "name": "freeDeliveryThreshold",
            "flag": "free-delivery-threshold",
            "kind": "string",
            "nullable": true,
            "description": "Order amount from which delivery is free; null for never."
          },
          {
            "name": "minimumOrderAmountForDelivery",
            "flag": "minimum-order-amount-for-delivery",
            "kind": "string",
            "nullable": true,
            "description": "Smallest order delivered; null for any."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "settings_create_location",
      "group": "settings",
      "action": "create-location",
      "method": "POST",
      "path": "/settings/locations",
      "summary": "Add Pickup Point",
      "description": "Adds a pickup and return point: a `name`, an `address`, and optionally its city, postal code, country (the store's by default) and coordinates. Customers can choose it at checkout once `multiLocationEnabled` is on (`PATCH /settings/delivery`). A new point is active. A store has 50 at most: one more is refused with `LOCATION_LIMIT_REACHED`. Returns the point with its `id`. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "required": true,
            "description": "How customers see the point (\"Plage du Moulin Blanc\")."
          },
          {
            "name": "address",
            "flag": "address",
            "kind": "string",
            "required": true
          },
          {
            "name": "city",
            "flag": "city",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "postalCode",
            "flag": "postal-code",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "country",
            "flag": "country",
            "kind": "string",
            "enum": [
              "AT",
              "BE",
              "CH",
              "CZ",
              "DE",
              "DK",
              "ES",
              "FI",
              "FR",
              "GB",
              "GR",
              "HR",
              "HU",
              "IE",
              "IT",
              "LU",
              "MC",
              "NL",
              "NO",
              "PL",
              "PT",
              "RO",
              "SE",
              "CA",
              "MX",
              "US",
              "AR",
              "BR",
              "CL",
              "CO",
              "AU",
              "CN",
              "HK",
              "IN",
              "JP",
              "KR",
              "MY",
              "NZ",
              "PH",
              "SG",
              "TH",
              "TW",
              "VN",
              "AE",
              "IL",
              "MA",
              "SA",
              "ZA"
            ],
            "nullable": true,
            "description": "Defaults to the store's country."
          },
          {
            "name": "latitude",
            "flag": "latitude",
            "kind": "number",
            "nullable": true
          },
          {
            "name": "longitude",
            "flag": "longitude",
            "kind": "number",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_update_location",
      "group": "settings",
      "action": "update-location",
      "method": "PATCH",
      "path": "/settings/locations/{id}",
      "summary": "Update Pickup Point",
      "description": "Changes a pickup point. Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. A null clears an optional field (city, postal code, country, coordinates). An unknown id answers `LOCATION_NOT_FOUND`. Returns the point. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": false,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "description": "How customers see the point (\"Plage du Moulin Blanc\")."
          },
          {
            "name": "address",
            "flag": "address",
            "kind": "string"
          },
          {
            "name": "city",
            "flag": "city",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "postalCode",
            "flag": "postal-code",
            "kind": "string",
            "nullable": true
          },
          {
            "name": "country",
            "flag": "country",
            "kind": "string",
            "enum": [
              "AT",
              "BE",
              "CH",
              "CZ",
              "DE",
              "DK",
              "ES",
              "FI",
              "FR",
              "GB",
              "GR",
              "HR",
              "HU",
              "IE",
              "IT",
              "LU",
              "MC",
              "NL",
              "NO",
              "PL",
              "PT",
              "RO",
              "SE",
              "CA",
              "MX",
              "US",
              "AR",
              "BR",
              "CL",
              "CO",
              "AU",
              "CN",
              "HK",
              "IN",
              "JP",
              "KR",
              "MY",
              "NZ",
              "PH",
              "SG",
              "TH",
              "TW",
              "VN",
              "AE",
              "IL",
              "MA",
              "SA",
              "ZA"
            ],
            "nullable": true,
            "description": "Defaults to the store's country."
          },
          {
            "name": "latitude",
            "flag": "latitude",
            "kind": "number",
            "nullable": true
          },
          {
            "name": "longitude",
            "flag": "longitude",
            "kind": "number",
            "nullable": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_set_location_active",
      "group": "settings",
      "action": "set-location-active",
      "method": "POST",
      "path": "/settings/locations/{id}/active",
      "summary": "Turn Pickup Point On or Off",
      "description": "Shows (`isActive: true`) or hides (`false`) a pickup point at checkout. Reservations that already use it keep it. An unknown id answers `LOCATION_NOT_FOUND`. Returns the point. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "isActive",
            "flag": "is-active",
            "kind": "boolean",
            "required": true,
            "description": "false hides the point from checkout; its past reservations keep it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "settings_update_taxes",
      "group": "settings",
      "action": "update-taxes",
      "method": "PATCH",
      "path": "/settings/taxes",
      "summary": "Update Taxes",
      "description": "Changes the store's taxes: on or off, the default rate in percent (0 to 100; 20 for 20 %), whether prices include tax (`inclusive`) or have it added (`exclusive`), the tax's label on documents (20 characters at most) and the store's tax number (30 at most). Send only the fields to change; a request with none is refused with `NOTHING_TO_UPDATE`. A null clears the label or the number. Any change asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview. Returns the taxes. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "enabled",
            "flag": "enabled",
            "kind": "boolean",
            "description": "Show and charge tax on prices."
          },
          {
            "name": "defaultRate",
            "flag": "default-rate",
            "kind": "number",
            "description": "Percent, such as 20 for 20 %."
          },
          {
            "name": "displayMode",
            "flag": "display-mode",
            "kind": "string",
            "enum": [
              "inclusive",
              "exclusive"
            ],
            "description": "inclusive: prices include tax (TTC); exclusive: tax is added on top (HT)."
          },
          {
            "name": "taxLabel",
            "flag": "tax-label",
            "kind": "string",
            "nullable": true,
            "description": "The tax's name on documents (\"TVA\", \"VAT\"); null for the default."
          },
          {
            "name": "taxNumber",
            "flag": "tax-number",
            "kind": "string",
            "nullable": true,
            "description": "The store's tax number; null clears it."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "settings_get_legal_profile",
      "group": "settings",
      "action": "get-legal-profile",
      "method": "GET",
      "path": "/settings/legal-profile",
      "summary": "Get Legal Profile",
      "description": "Returns the store's legal identity, as invoices, contracts and the legal notice name it: legal name and form, company number (the SIREN in France, the BCE number in Belgium), SIRET, VAT number, trade register city, share capital, registered office, and the electronic invoicing settings (`invoicingEnabled`, `vatRegime`, `hasVatOnDebits`). `profile` is null until the store saved one with `PATCH /settings/legal-profile`. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "settings_update_legal_profile",
      "group": "settings",
      "action": "update-legal-profile",
      "method": "PATCH",
      "path": "/settings/legal-profile",
      "summary": "Update Legal Profile",
      "description": "Saves the store's legal identity: legal name and form, company number (the SIREN in France, 9 digits; the BCE number in Belgium, 10), SIRET (14 digits), VAT number, trade register city, share capital (a decimal string), registered office, and the electronic invoicing settings. A first save needs `legalName`, `legalForm`, `companyNumber`, `registeredAddress`, `registeredPostalCode` and `registeredCity`; `country` defaults to the store's. Later, send only the fields to change; null clears an optional one. A profile missing a required field, or with one in the wrong format, is refused with `LEGAL_PROFILE_INVALID`, each field and its problem in `details.problems`. With `invoicingEnabled: true`, Louez generates the store's invoices; it needs `vatRegime`. The setting itself transmits nothing: an invoice goes to the tax network only when the store has an active SuperPDP integration and its legal profile is in France or Belgium, and is otherwise marked not applicable for transmission. A change of `invoicingEnabled`, `vatRegime` or `hasVatOnDebits` asks for a confirmation first (412 `CONFIRMATION_REQUIRED`) on a key that asks for confirmations, with each value before and after in the preview; the identity alone is saved directly. Returns the profile. `links.dashboard` is the page of these settings in the Louez dashboard; once the store is online, `links.storefront` is its storefront's home.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "legalName",
            "flag": "legal-name",
            "kind": "string",
            "description": "The company's legal name (raison sociale), or the sole trader's name."
          },
          {
            "name": "legalForm",
            "flag": "legal-form",
            "kind": "string",
            "description": "The legal form, such as SAS, SARL, Entrepreneur individuel."
          },
          {
            "name": "companyNumber",
            "flag": "company-number",
            "kind": "string",
            "description": "The company number: the SIREN in France (9 digits), the BCE number in Belgium."
          },
          {
            "name": "siret",
            "flag": "siret",
            "kind": "string",
            "nullable": true,
            "description": "The SIRET of the establishment (14 digits), in France. null clears it."
          },
          {
            "name": "vatNumber",
            "flag": "vat-number",
            "kind": "string",
            "nullable": true,
            "description": "The intra-community VAT number (FR + 11 characters in France). null clears it."
          },
          {
            "name": "rcsCity",
            "flag": "rcs-city",
            "kind": "string",
            "nullable": true,
            "description": "The city of the trade register (RCS) the company is registered at. null clears it."
          },
          {
            "name": "shareCapital",
            "flag": "share-capital",
            "kind": "string",
            "nullable": true,
            "description": "The share capital, as a decimal string (1000.00). null clears it."
          },
          {
            "name": "registeredAddress",
            "flag": "registered-address",
            "kind": "string",
            "description": "The registered office's street address."
          },
          {
            "name": "registeredAddressComplement",
            "flag": "registered-address-complement",
            "kind": "string",
            "nullable": true,
            "description": "A second address line. null clears it."
          },
          {
            "name": "registeredPostalCode",
            "flag": "registered-postal-code",
            "kind": "string",
            "description": "The registered office's postal code."
          },
          {
            "name": "registeredCity",
            "flag": "registered-city",
            "kind": "string",
            "description": "The registered office's city."
          },
          {
            "name": "country",
            "flag": "country",
            "kind": "string",
            "description": "Where the company is registered, as ISO 3166-1 alpha-2 (FR)."
          },
          {
            "name": "invoicingEnabled",
            "flag": "invoicing-enabled",
            "kind": "boolean",
            "description": "Whether Louez issues the store's invoices as legal electronic invoices. Needs vatRegime."
          },
          {
            "name": "vatRegime",
            "flag": "vat-regime",
            "kind": "string",
            "enum": [
              "monthly",
              "quarterly",
              "simplified",
              "vat_exemption"
            ],
            "nullable": true,
            "description": "How often the company declares VAT; it sets the e-reporting calendar."
          },
          {
            "name": "hasVatOnDebits",
            "flag": "has-vat-on-debits",
            "kind": "boolean",
            "description": "Whether the company opted for VAT on debits (TVA sur les débits)."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "settings_search_company_registry",
      "group": "settings",
      "action": "search-company-registry",
      "method": "GET",
      "path": "/settings/company-registry",
      "summary": "Search Company Registry",
      "description": "Looks a French company up in the public registry (recherche-entreprises.api.gouv.fr) by `query`: its name, SIREN or SIRET, 3 to 120 characters. Returns up to 8 matches, each with its SIREN, SIRET, legal name, legal form, VAT number, registered office, trade register city and whether it is still active. A match maps onto `PATCH /settings/legal-profile`: `siren` as `companyNumber`, `address` as `registeredAddress`, `addressComplement` as `registeredAddressComplement`, `postalCode` as `registeredPostalCode`, `city` as `registeredCity`; the other fields keep their names. `available: false` means the registry did not answer, and `results` is empty.",
      "pathParams": [],
      "query": [
        {
          "name": "query",
          "flag": "query",
          "kind": "string",
          "required": true,
          "description": "A company name, a SIREN (9 digits) or a SIRET (14 digits); 3 characters at least."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "account_get_profile",
      "group": "account",
      "action": "get-profile",
      "method": "GET",
      "path": "/account/profile",
      "summary": "Get Account Profile",
      "description": "Returns the Louez account the API key acts for, its owner's: its `id`, stable and never reused, and its `name`, left out when the account has none. Takes no parameter.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "stores_list",
      "group": "stores",
      "action": "list",
      "method": "GET",
      "path": "/stores",
      "summary": "List Stores",
      "description": "Lists the stores the key reaches, by name. An API key is bound to one store, so the list holds that store alone. Each store has its `id`, `name` and `slug`, the `role` in it of the user the key belongs to (`owner` or `member`), and `links`: `links.dashboard`, its page in the Louez dashboard, and once the store is online, `links.storefront`, its online store. `limit` (100 by default and at most) and `cursor` page the list; `nextCursor` is null on the last page.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Stores per page, 100 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "stores_create",
      "group": "stores",
      "action": "create",
      "method": "POST",
      "path": "/stores",
      "summary": "Create Store",
      "description": "Creates a store. No API key can call it: an API key is bound to its store and is answered 403 CONNECTION_BOUND_TO_STORES. A new store is created in the Louez dashboard.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "name",
            "flag": "name",
            "kind": "string",
            "required": true,
            "description": "The store's name, as customers see it."
          },
          {
            "name": "slug",
            "flag": "slug",
            "kind": "string",
            "required": true,
            "description": "The store's web address: 3 to 50 lowercase letters, digits and hyphens. Check it first with stores_check_slug_availability."
          },
          {
            "name": "country",
            "flag": "country",
            "kind": "string",
            "enum": [
              "AT",
              "BE",
              "CH",
              "CZ",
              "DE",
              "DK",
              "ES",
              "FI",
              "FR",
              "GB",
              "GR",
              "HR",
              "HU",
              "IE",
              "IT",
              "LU",
              "MC",
              "NL",
              "NO",
              "PL",
              "PT",
              "RO",
              "SE",
              "CA",
              "MX",
              "US",
              "AR",
              "BR",
              "CL",
              "CO",
              "AU",
              "CN",
              "HK",
              "IN",
              "JP",
              "KR",
              "MY",
              "NZ",
              "PH",
              "SG",
              "TH",
              "TW",
              "VN",
              "AE",
              "IL",
              "MA",
              "SA",
              "ZA"
            ],
            "required": true,
            "description": "Where the store is, as an ISO 3166-1 alpha-2 code (FR). It sets the time zone."
          },
          {
            "name": "currency",
            "flag": "currency",
            "kind": "string",
            "enum": [
              "EUR",
              "GBP",
              "CHF",
              "SEK",
              "NOK",
              "DKK",
              "PLN",
              "CZK",
              "HUF",
              "RON",
              "USD",
              "CAD",
              "MXN",
              "BRL",
              "ARS",
              "CLP",
              "COP",
              "AUD",
              "NZD",
              "JPY",
              "CNY",
              "INR",
              "SGD",
              "HKD",
              "KRW",
              "TWD",
              "THB",
              "MYR",
              "PHP",
              "VND",
              "AED",
              "SAR",
              "ILS",
              "ZAR",
              "MAD"
            ],
            "required": true,
            "description": "The store's currency, as an ISO 4217 code (EUR)."
          },
          {
            "name": "address",
            "flag": "address",
            "kind": "string",
            "description": "The store's postal address, on one line."
          },
          {
            "name": "latitude",
            "flag": "latitude",
            "kind": "number",
            "nullable": true
          },
          {
            "name": "longitude",
            "flag": "longitude",
            "kind": "number",
            "nullable": true
          },
          {
            "name": "email",
            "flag": "email",
            "kind": "string",
            "description": "The store's contact e-mail, shown to customers."
          },
          {
            "name": "phone",
            "flag": "phone",
            "kind": "string",
            "description": "The store's contact phone, in international format (+33…)."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "stores_check_slug_availability",
      "group": "stores",
      "action": "check-slug-availability",
      "method": "GET",
      "path": "/stores/slug-availability",
      "summary": "Check New Store Address",
      "description": "Checks whether a new store could take a web address (its slug: 3 to 50 lowercase letters, digits and hyphens). Answers `available` and, when it cannot, the `reason` (`taken`, `reserved` or `invalid`) with up to 3 free `suggestions` close to it. A name works too in `slug`: the suggestions come from it. A store is created with `POST /stores`, which no API key can call; to change the address of the key's own store, check it with `GET /online-store/slug-availability`.",
      "pathParams": [],
      "query": [
        {
          "name": "slug",
          "flag": "slug",
          "kind": "string",
          "required": true,
          "description": "The web address to check. A name works too: suggestions come from it."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "stores_get_launch_checklist",
      "group": "stores",
      "action": "get-launch-checklist",
      "method": "GET",
      "path": "/stores/launch-checklist",
      "summary": "Get Launch Checklist",
      "description": "Returns what the store still lacks before customers can book, and whether it is `online`. Each entry of `items` has a `status`:\n\n- `done`: in place.\n- `missing`: customers will miss it; a `required` one stops `POST /stores/go-live`.\n- `optional`: the store works well without it.\n- `blocked`: Louez billing stops new bookings; only a person fixes it, in the Louez dashboard.\n- `unverified`: in place, but Louez cannot read it to check it, such as the text of a legal notice of the store's own.\n\nEach item says why it matters, names the operations that fix it by `operationId` (none when only a person can) and has `links.dashboard`, the page where it is seen or fixed. `canGoLive` and `blocking` sum up the required items still missing. The answer also gives how customers book (`bookingMode`: without Stripe charges enabled, a store in payment mode takes requests), the online store's address (the future one while offline), what the law asks of the store in its country (`legalRequirements`, null where Louez knows no rule) and `warnings`, which never stop the launch. `milestones` (the first reservation, the first completed one) is null with a key that cannot read reservations.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "stores_go_live",
      "group": "stores",
      "action": "go-live",
      "method": "POST",
      "path": "/stores/go-live",
      "summary": "Put Store Online",
      "description": "Puts the store online: its online store opens to the public. Customers can book only while Louez billing lets the store take new bookings: a store whose billing stops them (the `blocked` billing item of `GET /stores/launch-checklist`) may still go live, and its online store then says it is not taking bookings. Refused with `STORE_NOT_READY` while a required item of `GET /stores/launch-checklist` is missing, each one in `details.blocking`. `reservationMode` sets how customers book: `payment` (they pay at checkout; without Stripe charges enabled, they send requests until then) or `request` (the store accepts or refuses each request); left out, the store keeps its choice. On a key that asks for confirmations, it asks for one first (412 `CONFIRMATION_REQUIRED`), with a preview of the public address, how customers book, what they will see, and what is still missing, to check or optional. A store already online is not launched again and answers with `launched: false`; with another `reservationMode`, only the booking mode changes, after the same confirmation. Returns the online store's address, the booking mode, the items still missing or optional (`remaining`), the `warnings`, and `links.dashboard` and `links.storefront`.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "reservationMode",
            "flag": "reservation-mode",
            "kind": "string",
            "enum": [
              "payment",
              "request"
            ],
            "description": "How customers book: payment (they pay online at checkout; without Stripe connected they send requests until it is) or request (they send a request the store accepts or refuses). Leave it out to keep the store's choice."
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "inbox_list",
      "group": "inbox",
      "action": "list",
      "method": "GET",
      "path": "/inbox",
      "summary": "List Inbox",
      "description": "Lists what needs the store's attention now: booking requests to answer, return-date requests, late pickups and returns, deposit holds about to expire, failed payments, open disputes, bookings on a retired or out-of-service unit, overbookings, supplier invoices and rejected e-invoices, Louez billing stopping new bookings, a store not online yet, messages and invitation e-mails that never went out, the key's own writes whose outcome is unknown, and steps taken in a browser (such as Stripe's onboarding) still waiting an hour after their link went out, expired or failed. Each item has an `id`, a `type`, a `severity` (`critical`, `warning` or `info`), `occurredAt`, a one-sentence `summary`, the `reservation` it is about, the facts behind it in `details`, the operations that act on it by `operationId` (none when only a person can, in the Louez dashboard) and `links.dashboard`.\n\nEach call returns one page. Without `cursor`, it is the oldest page of the inbox as it is now; follow `nextCursor` while `hasMore` is true. With the `nextCursor` of an earlier answer as `cursor`, it returns the items that entered the inbox after that point, in the order they did. A cursor is a position in a live feed, not a snapshot: calling again with the same one can return more items, as new ones arrive, and fewer, as items are handled. It only reads. An item shows 30 seconds after it happens, and leaves the inbox once what it is about is handled (the request answered, the reservation returned); the same `id` with a later `occurredAt` means it came back. `POST /inbox/acknowledge` hides an item for the whole store. When Louez cannot read some item types, the others still come and `unavailable` names the missing ones; their items come with a later call at `nextCursor`, late but not lost, while the other types are not given again. Up to `limit` items a call (50 by default, 100 at most). `types` narrows it to some types of item, among those the key may read; a value that is not a type answers `BAD_REQUEST`. A cursor follows the types of the call that returned it: pass the same `types` with it. A cursor this operation did not return answers `INVALID_CURSOR`. Each type of item shows only to a key that can read what it shows: payments for payment items, customers for the customer's name.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous call. Leave it out to read the whole inbox from the oldest item."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Items per call (default 50, at most 100)."
        },
        {
          "name": "types",
          "flag": "types",
          "kind": "string",
          "enum": [
            "booking_request",
            "date_change_request",
            "pickup_overdue",
            "return_overdue",
            "deposit_expiring",
            "payment_failed",
            "deposit_unconfirmed",
            "deposit_release_failed",
            "refund_unconfirmed",
            "refund_undone",
            "credit_note_not_issued",
            "dispute_open",
            "unit_conflict",
            "overbooking",
            "supplier_invoice",
            "einvoice_rejected",
            "billing_gate_closed",
            "store_not_live",
            "message_not_sent",
            "operation_unknown",
            "handoff_waiting",
            "approval_waiting",
            "invitation_not_sent",
            "image_job_failed",
            "partner_payout_due"
          ],
          "list": true,
          "description": "Only items of these types, among those the caller may read: a type it may not read stays out. Leave it out for every type. A cursor follows the types of the call that returned it: pass the same types with it."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "inbox_acknowledge",
      "group": "inbox",
      "action": "acknowledge",
      "method": "POST",
      "path": "/inbox/acknowledge",
      "summary": "Mark Inbox Items Handled",
      "description": "Marks inbox items as handled for the whole store: they leave `GET /inbox` for every member and every key. Takes each item's `id` and `occurredAt` as `GET /inbox` returned them, up to 100 at once. Items the inbox does not hold now with that `occurredAt` are left unmarked and come back in `rejected`: with `currentOccurredAt` when the inbox holds the item with another occurrence (send it again with that one to mark it), null when it left the inbox. After a rejection, `GET /inbox` without a cursor gives what the inbox holds now. Marking an item twice changes nothing; it counts in `alreadyAcknowledged`. An item that comes back later (the same `id`, a later `occurredAt`) shows again, and so does one still open 90 days after its mark. An item whose record is handled leaves the inbox by itself. Needs a key that can change what the item is about (payments for a failed payment, reservations for a booking request), else `PERMISSION_DENIED`; an `id` that is not an inbox item's answers `INBOX_ITEM_INVALID`.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "items",
            "flag": "items",
            "kind": "json",
            "required": true
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "record_payment",
      "group": "payments",
      "action": "record",
      "method": "POST",
      "path": "/reservations/{reservationId}/payments",
      "summary": "Record Payment",
      "description": "Records a payment row the store handled itself on a reservation: its `type` (`rental`, `deposit`, `deposit_return`, `damage` or `adjustment`), its amount and how it was paid (cash, card, transfer, check or other). Money the store paid back is a negative `adjustment`. It moves no money. A `deposit_return` recorded here is not checked against the deposit collected: to record a deposit given back against that balance, use `POST /reservations/{reservationId}/deposit-returns`. Refused, before anything is asked, for an amount that is zero, not a plain decimal with at most 8 digits before the point and 2 after, or with more decimals than the reservation's currency, such as decimals in yen (`PAYMENT_AMOUNT_INVALID`, whose `details` then give the currency and its decimals), a reservation in a three-decimal currency, which Louez's billing does not count (`PAYMENT_CURRENCY_NOT_SUPPORTED`), a negative amount of another type than `adjustment`, and a cancelled or rejected reservation. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview of the payment and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "reservationId",
          "flag": "reservation-id",
          "kind": "string",
          "required": true,
          "description": "The reservation ID"
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "type",
            "flag": "type",
            "kind": "string",
            "enum": [
              "rental",
              "deposit",
              "deposit_return",
              "damage",
              "adjustment"
            ],
            "required": true,
            "description": "Payment type"
          },
          {
            "name": "amount",
            "flag": "amount",
            "kind": "string",
            "required": true,
            "description": "Amount (e.g. \"150.00\")"
          },
          {
            "name": "method",
            "flag": "method",
            "kind": "string",
            "enum": [
              "cash",
              "card",
              "transfer",
              "check",
              "other"
            ],
            "required": true,
            "description": "Payment method"
          },
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "description": "Optional notes"
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "record_deposit_return",
      "group": "payments",
      "action": "record-deposit-return",
      "method": "POST",
      "path": "/reservations/{reservationId}/deposit-returns",
      "summary": "Record Deposit Return",
      "description": "Records a deposit the store has already given back: the amount and how (cash, card, transfer, check or other). It moves no money: nothing is refunded or released, through Stripe or otherwise. Refused with `DEPOSIT_RETURN_AMOUNT_INVALID` for an amount that is zero, negative, not a plain decimal with at most 8 digits before the point and 2 after, or with more decimals than the reservation's currency (its `details` then give the currency and its decimals), with `PAYMENT_CURRENCY_NOT_SUPPORTED` for a reservation in a three-decimal currency, and with `DEPOSIT_RETURN_EXCEEDS_BALANCE` above the returnable balance: the reservation's completed `deposit` rows minus its completed `deposit_return` rows. Stripe deposit holds and captures are not in that balance. The check is this operation's own: a `deposit_return` recorded with `POST /reservations/{reservationId}/payments` is not checked. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview showing that balance and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "reservationId",
          "flag": "reservation-id",
          "kind": "string",
          "required": true,
          "description": "The reservation ID"
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "amount",
            "flag": "amount",
            "kind": "string",
            "required": true,
            "description": "Amount given back"
          },
          {
            "name": "method",
            "flag": "method",
            "kind": "string",
            "enum": [
              "cash",
              "card",
              "transfer",
              "check",
              "other"
            ],
            "required": true,
            "description": "How the deposit was given back"
          },
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "description": "Optional notes"
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "record_refund",
      "group": "payments",
      "action": "record-refund",
      "method": "POST",
      "path": "/payments/{paymentId}/refund-records",
      "summary": "Record Refund",
      "description": "Records a refund the store already gave by hand (cash, card terminal, bank transfer, check or other) against one payment it took by hand: a `rental`, `damage`, `adjustment` or `deposit_capture` payment. It moves no money. The refund is its own positive `completed` row pointing at the payment, in the payment's own currency; the payment keeps its amount. Partial refunds may follow one another, up to the payment's amount less every completed refund already recorded against it, counted under the reservation's lock. Refused, before anything is asked, for a payment the store does not have (`PAYMENT_NOT_FOUND`); an amount that is zero, negative, not a plain decimal with at most 8 digits before the point and 2 after, or with a digit past the minor unit of the payment's currency, such as decimals in yen (`REFUND_AMOUNT_INVALID`); a payment in a three-decimal currency, which Louez's billing does not count (`REFUND_CURRENCY_NOT_SUPPORTED`); a payment that is itself a refund (`REFUND_OF_REFUND`); a deposit, a deposit return or a deposit hold (`REFUND_PAYMENT_TYPE_NOT_REFUNDABLE`); a payment not completed (`REFUND_PAYMENT_NOT_COMPLETED`); a payment taken online through Stripe, which is refunded by refunding the payment instead (`REFUND_STRIPE_PAYMENT`); a payment of zero or below (`REFUND_PAYMENT_NOT_RECEIVED`); and an amount above the payment's amount less every completed refund already recorded against it (`REFUND_EXCEEDS_REFUNDABLE`, whose details give the amounts paid, already refunded and refundable, and the currency). It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview of the refund, the payment and what is left to refund and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the refund's id (`refundId`), its `currency` and `creditNote`: `status` `issued` with its `number`, `pending` (owed: Louez issues it, retrying on its own), or `not_applicable` (the store issues no invoices, or the payment refunded has none). The refund stands whatever `creditNote` says. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "paymentId",
          "flag": "payment-id",
          "kind": "string",
          "required": true,
          "description": "The ID of the payment the store refunded"
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "amount",
            "flag": "amount",
            "kind": "string",
            "required": true,
            "description": "Amount given back, in the payment's own currency (e.g. \"30.00\")"
          },
          {
            "name": "method",
            "flag": "method",
            "kind": "string",
            "enum": [
              "cash",
              "card",
              "transfer",
              "check",
              "other"
            ],
            "required": true,
            "description": "How the money was given back"
          },
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "description": "Optional notes"
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "refund_payment",
      "group": "payments",
      "action": "refund",
      "method": "POST",
      "path": "/payments/{paymentId}/refunds",
      "summary": "Refund Payment",
      "description": "Refunds all or part of a payment the store took online, back to the means that paid it, through Stripe: a `rental`, `damage`, `adjustment` or `deposit_capture` payment. The amount is in the payment's own currency, with at most its decimals. Partial refunds may follow one another. One refund is one durable operation: it reaches Stripe at most once, and its outcome can always be read with `GET /payments/{paymentId}/refunds/{refundId}`. No message is sent to the customer. Refused, before anything is asked, for a payment the store does not have (`PAYMENT_NOT_FOUND`); one taken by hand, whose refund is recorded instead (`REFUND_PAYMENT_TAKEN_BY_HAND`); an amount that is zero, negative, or has more decimals than the payment's currency (`REFUND_AMOUNT_INVALID`); a three-decimal currency (`REFUND_CURRENCY_NOT_SUPPORTED`); a deposit hold, a refund row or a failed payment (`PAYMENT_NOT_REFUNDABLE`); a payment not settled at Stripe (`PAYMENT_NOT_SETTLED`); an open dispute (`PAYMENT_DISPUTED`); a charge recorded on several reservations (`PAYMENT_CHARGE_SHARED`); no Stripe account (`NO_STRIPE_ACCOUNT`); and an amount above what the charge can still give back, refunds given by hand and refunds in progress counted (`REFUND_EXCEEDS_REFUNDABLE`, whose details give the amounts paid, refunded, being refunded and refundable, and the currency). Stripe not answering the first read refuses with `STRIPE_UNAVAILABLE`, nothing asked. A dashboard session is refused with `REFUND_NOT_FROM_DASHBOARD`. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview of the refund, the payment and what stays refundable and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Even once approved, Stripe may still refuse the refund (a dispute opened meanwhile, a balance too low): it then answers failed with the reason, the approval is spent, and nothing else changes. The answer is the refund's state: `pending` while Stripe has not given the final outcome (`detail` `sending` while Louez may still send it, `awaiting_provider` once only Stripe's own account of the charge settles it, `processing` once Stripe has issued the refund and the bank is processing it: recorded among the reservation's payments, not yet received by the customer, and it may still fail), `succeeded` once Stripe states the refund succeeded, or `failed` with `failure`. It never answers an error once the refund is recorded. The platform's `Idempotency-Key` answers the same refund, as first answered or, if that answer was lost, as it is now (`Louez-Replayed`); it may be `pending`: read the refund for its outcome rather than repeating the request. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "paymentId",
          "flag": "payment-id",
          "kind": "string",
          "required": true,
          "description": "The ID of the payment taken online to refund"
        }
      ],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "amount",
            "flag": "amount",
            "kind": "string",
            "required": true,
            "description": "Amount to give back, in the payment's own currency, with at most its decimals (e.g. \"45.00\"; whole units in yen)"
          },
          {
            "name": "reason",
            "flag": "reason",
            "kind": "string",
            "enum": [
              "requested_by_customer",
              "duplicate"
            ],
            "description": "Why it is refunded, as Stripe records it (default requested_by_customer)"
          },
          {
            "name": "notes",
            "flag": "notes",
            "kind": "string",
            "description": "Optional notes, kept on the refund"
          }
        ]
      },
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "get_refund",
      "group": "payments",
      "action": "get-refund",
      "method": "GET",
      "path": "/payments/{paymentId}/refunds/{refundId}",
      "summary": "Get Refund",
      "description": "Reads a refund made with `POST /payments/{paymentId}/refunds`. The answer is the refund's state: `pending` while Stripe has not given the final outcome (`detail` `sending` while Louez may still send it, `awaiting_provider` once only Stripe's own account of the charge settles it, `processing` once Stripe has issued the refund and the bank is processing it: recorded among the reservation's payments, not yet received by the customer, and it may still fail), `succeeded` once Stripe states the refund succeeded, or `failed` with `failure`. It never answers an error once the refund is recorded. While it is pending, a read may settle it with Stripe once, under the refund's own rules (never a second request to Stripe beyond them), at most every 30 seconds and less often as the refund ages: a read in between answers the state as it stands. A refund made in Stripe's own dashboard has no refund here: 404 `REFUND_NOT_FOUND`, by design; it shows among the reservation's payments. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "paymentId",
          "flag": "payment-id",
          "kind": "string",
          "required": true,
          "description": "The ID of the payment refunded"
        },
        {
          "name": "refundId",
          "flag": "refund-id",
          "kind": "string",
          "required": true,
          "description": "The refund's ID (`refund.id`), as the refund's answer gave it"
        }
      ],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "delete_payment",
      "group": "payments",
      "action": "delete",
      "method": "DELETE",
      "path": "/payments/{paymentId}",
      "summary": "Delete Payment",
      "description": "Deletes a payment recorded on a reservation: it leaves the reservation's balance and the billing figures. A payment made through Stripe is refused: refund it in Stripe. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview of the payment and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the reservation's number and, with a key that can read reservations, its `links.dashboard`.",
      "pathParams": [
        {
          "name": "paymentId",
          "flag": "payment-id",
          "kind": "string",
          "required": true,
          "description": "The payment ID to delete"
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "payments_start_stripe_onboarding",
      "group": "stripe",
      "action": "start-onboarding",
      "method": "POST",
      "path": "/payments/stripe/onboarding",
      "summary": "Connect Stripe",
      "description": "Starts connecting the store to Stripe so it takes online payments, or finishes a setup left midway. Stripe asks the person for their identity and bank details on its own pages, which only they can fill in. It returns `url`, a link to the step's page in Louez, to open in a browser: it opens for the Louez user the key belongs to, once signed in, who goes on to the provider from there and comes back. Only that person can finish the step. The link works for 24 hours. Calling again returns the same link for 24 more hours, an expired one included; after a step completed or failed, it starts a new one. `handoff.id` is what `GET /handoffs/{id}` takes to read where the step stands: `pending`, `opened`, `completed`, `expired` or `failed`. When a Stripe account must be created for the store, the step fails with `failure.code` `store_email_required` if neither the store's contact e-mail (`PATCH /settings/store-info` sets it) nor its owner's is usable. Once it is completed, `POST /payments/stripe/sync` reads where Stripe stands: Stripe may still review the details before charges are enabled, and the online store takes requests rather than payments until then. Refused with `STRIPE_ALREADY_CONNECTED` when the store already takes payments, and `STRIPE_NOT_CONFIGURED` when this Louez has no Stripe.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": []
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "payments_open_stripe_dashboard",
      "group": "stripe",
      "action": "open-dashboard",
      "method": "POST",
      "path": "/payments/stripe/dashboard",
      "summary": "Open Stripe Dashboard",
      "description": "Starts a visit to the store's own Stripe dashboard (payouts, disputes, bank details), where the person signs in to Stripe. It returns `url`, a link to the step's page in Louez, to open in a browser: it opens for the Louez user the key belongs to, once signed in, who goes on to the provider from there and comes back. Only that person can finish the step. The link works for 24 hours. Calling again returns the same link for 24 more hours, an expired one included; after a step completed or failed, it starts a new one. `handoff.id` is what `GET /handoffs/{id}` takes to read where the step stands: `pending`, `opened`, `completed`, `expired` or `failed`. The step completes once the person is on their way to Stripe. Refused with `NO_STRIPE_ACCOUNT` when the store has no Stripe account, and `STRIPE_NOT_CONFIGURED` when this Louez has no Stripe.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": []
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "payments_sync_stripe_status",
      "group": "stripe",
      "action": "sync-status",
      "method": "POST",
      "path": "/payments/stripe/sync",
      "summary": "Refresh Stripe Status",
      "description": "Reads the store's Stripe account from Stripe now and saves it in Louez. Returns whether it takes charges (`chargesEnabled`) and payouts (`payoutsEnabled`), whether its details were submitted (`detailsSubmitted`), what Stripe still asks for (`requirements`, by Stripe's own field names), the booking mode the store chose and the one its online store applies (`bookingMode`: payment mode takes requests until charges are enabled), and `links.dashboard`, the payment settings page in the Louez dashboard. Once the details are submitted, it also completes the step `POST /payments/stripe/onboarding` started. Refused with `NO_STRIPE_ACCOUNT` when the store has no Stripe account, `STRIPE_NOT_CONFIGURED` when this Louez has no Stripe, and `STRIPE_UNAVAILABLE` (retryable) when Stripe does not answer as expected.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": []
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "billing_get_status",
      "group": "billing",
      "action": "get-status",
      "method": "GET",
      "path": "/billing",
      "summary": "Get Louez Billing Status",
      "description": "Returns what Louez bills the store, as its billing pages in the dashboard show it: who bills it (`billing`: `none`, `legacy` or `service`), the plan in force or pay-as-you-go (`mode`, `plan`), the offer and the billing service's notice in its own words, the pay-as-you-go fees and this month's figures, the card on file, the month-end invoices (newest first), the unpaid balance, whether Louez billing lets the store take new bookings (`gate`) and why not, and whether a billing card can be added now (`cardSetup.available`; `cardSetup.reason` says why not: `not_billed_by_service` when Louez's billing service does not bill the store, `off` or `in_louez` when that service does not open a card setup now). `cardSetup` reports the store's billing, not the key's rights: `POST /billing/card-setup` also needs a key that can change billing. Amounts are decimal strings with their currency. It only reads: a plan is changed or cancelled in the Louez dashboard, at `links.dashboard`. Needs a key of the store's owner that can read billing; another key answers `PERMISSION_DENIED`.",
      "pathParams": [],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "billing_start_card_setup",
      "group": "billing",
      "action": "start-card-setup",
      "method": "POST",
      "path": "/billing/card-setup",
      "summary": "Add Billing Card",
      "description": "Starts adding or replacing the card Louez charges the store's fees on, on Stripe's page: only the person can type it. It serves when Louez billing stops new bookings until a card is added, or the card expired, as `GET /billing` and `GET /inbox` show. It returns `url`, a link to the step's page in Louez, to open in a browser: it opens for the Louez user the key belongs to, once signed in, who goes on to the provider from there and comes back. Only that person can finish the step. The link works for 24 hours. Calling again returns the same link for 24 more hours, an expired one included; after a step completed or failed, it starts a new one. `handoff.id` is what `GET /handoffs/{id}` takes to read where the step stands: `pending`, `opened`, `completed`, `expired` or `failed`. When the person comes back before Stripe confirmed the card, the step answers `confirming: true` and `POST /handoffs/{id}/refresh` asks Stripe again. Once completed, `GET /billing` shows the card and whether new bookings are accepted again. Needs a key of the store's owner that can change billing; another key answers `PERMISSION_DENIED`. On a store Louez's billing service does not bill, it answers `CARD_SETUP_UNAVAILABLE` with `details.reason` `not_billed_by_service`; `cardSetup` in `GET /billing` says beforehand whether a card can be added.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": []
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "handoffs_get",
      "group": "handoffs",
      "action": "get",
      "method": "GET",
      "path": "/handoffs/{id}",
      "summary": "Get Handoff Status",
      "description": "Returns where a step taken in a browser stands, by the `handoff.id` the operation that started it returned: `pending` (the link waits), `opened` (the person is on the provider's page), `completed`, `expired` (the link ran out; calling the operation that started it again gives the same link for another 24 hours) or `failed`, with `failure` saying why. It only reads. `confirming` is true while the person came back from Stripe with a billing card Stripe has not confirmed yet; `POST /handoffs/{id}/refresh` asks Stripe again. `url` is the step's link, the same the starting operation returned. Once completed, the result is read where the step leads: `POST /payments/stripe/sync` for Stripe, `GET /billing` for the billing card. For an approval (`operation_approval`, by the `data.details.approval.id` of an `APPROVAL_REQUIRED` answer): `pending` until the key's owner decides, `approved` once they approved and until the write is carried out, `completed` once the same request carried it out, `failed` when they refused or it ended (`failure.code`: `declined`, `state_changed`, `approver_not_allowed` or `connection_revoked`), `expired` when undecided within 24 hours or not carried out within an hour of the approval. Only the key that asked reads its approval, and the answer holds neither the request's input nor its operation: keep the request you sent. For a `team_invitation` step or an approval, `decision` holds what was decided on its page (`approved` or `refused`), when, and the `reason` given, as plain text; it is null until then. Needs a key that can read the step's domain: settings for Stripe, billing for the billing card, team for a team invitation, the write's own for an approval (payments, team or reservations); otherwise, and for an id the store does not have, it answers `HANDOFF_NOT_FOUND`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "handoffs_refresh",
      "group": "handoffs",
      "action": "refresh",
      "method": "POST",
      "path": "/handoffs/{id}/refresh",
      "summary": "Refresh Handoff Status",
      "description": "Asks the provider again where a step stands, records it and returns the step as `GET /handoffs/{id}` does. It acts on a billing card the person came back from while Stripe had not confirmed it (`confirming: true`): once Stripe confirms, the card is saved in place of the one on file and the step completes. Louez asks Stripe at most once in 30 seconds, a wait that grows after each check up to 5 minutes; during that wait, and for any other step, it answers without asking. Needs a key that can change the step's domain: billing for the billing card, settings for Stripe; otherwise `PERMISSION_DENIED`. An id the key cannot read answers `HANDOFF_NOT_FOUND`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "jobs_get",
      "group": "jobs",
      "action": "get",
      "method": "GET",
      "path": "/jobs/{id}",
      "summary": "Get Job Status",
      "description": "Returns where a background job stands, such as an AI photo enhancement or a background removal: `queued`, `running`, `succeeded` with its result, or `failed` with its `error` (nothing is charged for a failed run). `waitSeconds` (0 by default, 25 at most) waits for the job to end before answering; `pollAfterSeconds` says when to read it again. Photo jobs are started by `POST /products/{id}/images/enhance` and `POST /products/{id}/images/remove-background`. For a photo job, `source` is the photo before; once the job succeeded, `result` is the photo after, which replaced it on the product, with `creditsCharged`. `source.versionId` is the original's version id, which `POST /products/{id}/images/use-version` takes to put it back. `links.dashboard` is the product's page in the Louez dashboard and, while the product is active, `links.storefront` its page on the storefront. Needs a key that can read the job's domain, products for photo jobs (`PERMISSION_DENIED` otherwise); an unknown id answers `JOB_NOT_FOUND`.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true
        }
      ],
      "query": [
        {
          "name": "waitSeconds",
          "flag": "wait-seconds",
          "kind": "integer",
          "description": "Wait up to this many seconds (at most 25) for the job to end before answering. Default 0: answer at once."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "team_list_members",
      "group": "team",
      "action": "list-members",
      "method": "GET",
      "path": "/team/members",
      "summary": "List Team Members",
      "description": "Lists the people who work in the store, the newest to join first: name, e-mail, role (`owner` or `member`) and when they joined. Each `id` is the membership's, which `DELETE /team/members/{id}` takes. `memberLimit` is the store's allowance of members, owners aside: `current`, `limit` (null: unlimited) and `canAddMember`. Returns up to `limit` rows (100 by default and at most); pass `nextCursor` back as `cursor` to read on, null on the last page. A cursor this list did not return answers `INVALID_CURSOR`. `links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous team_list_members page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Rows per page, 100 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "team_list_invitations",
      "group": "team",
      "action": "list-invitations",
      "method": "GET",
      "path": "/team/invitations",
      "summary": "List Team Invitations",
      "description": "Lists the store's pending invitations, the newest first: the e-mail invited, the role, when it was sent (`invitedAt`) and when it expires (`expiresAt`; `expired` is true once past, when its link no longer works). Each `id` is what `POST /team/invitations/{id}/cancel` takes. Returns up to `limit` rows (100 by default and at most); pass `nextCursor` back as `cursor` to read on, null on the last page. A cursor this list did not return answers `INVALID_CURSOR`. `links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.",
      "pathParams": [],
      "query": [
        {
          "name": "cursor",
          "flag": "cursor",
          "kind": "string",
          "description": "The nextCursor of the previous team_list_invitations page. Leave it out for the first page."
        },
        {
          "name": "limit",
          "flag": "limit",
          "kind": "integer",
          "description": "Rows per page, 100 at most and by default."
        }
      ],
      "body": null,
      "idempotent": false,
      "confirmation": false
    },
    {
      "id": "team_invite_member",
      "group": "team",
      "action": "invite-member",
      "method": "POST",
      "path": "/team/invitations",
      "summary": "Invite Team Member",
      "description": "Asks to invite someone to the store as a member, the only role an invitation gives: a member sees the store's customers, reservations and payments and can change products and reservations. Only a key of an owner of the store may call it. With an API key, the call creates no invitation and sends no e-mail yet: it answers `outcome: \"approval_requested\"` with `approval.url`, the request's page in Louez, and `approval.handoff`. That page must be opened, signed in to Louez, by the user the key acts for, while they are still an owner of the store: they approve or refuse the request there, within 24 hours. `GET /handoffs/{id}` with `approval.handoff.id` then says what happened: read both its `status` and its `decision`, as an approved request can still fail to go out (`failure` says why). While the request is active, the same address asked again gets the same link, for 24 more hours. Refused with `TEAM_ALREADY_MEMBER` when the person is already a member, `TEAM_INVITATION_ALREADY_SENT` when an invitation of theirs is pending, `TEAM_LIMIT_REACHED` when the store has reached its member allowance, `TEAM_APPROVALS_FULL` when 10 such requests are already open, and `TEAM_INVITATION_EMAIL_LIMIT` past the store's 20 invitation e-mails in 24 hours. `links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.",
      "pathParams": [],
      "query": [],
      "body": {
        "required": true,
        "fields": [
          {
            "name": "email",
            "flag": "email",
            "kind": "string",
            "required": true,
            "description": "The e-mail address of the person to invite."
          },
          {
            "name": "role",
            "flag": "role",
            "kind": "string",
            "description": "Always \"member\", the only role an invitation gives. Owners are never invited."
          }
        ]
      },
      "idempotent": true,
      "confirmation": false
    },
    {
      "id": "team_cancel_invitation",
      "group": "team",
      "action": "cancel-invitation",
      "method": "POST",
      "path": "/team/invitations/{id}/cancel",
      "summary": "Cancel Team Invitation",
      "description": "Cancels a pending invitation: its link stops working and the person does not join. Takes the invitation's `id` from `GET /team/invitations`; one that is not a pending invitation of the store answers `TEAM_INVITATION_NOT_FOUND`. Only a key of an owner of the store may call it. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview naming the person and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the invitation's `id` and `email`. `links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true,
          "description": "The invitation's id, from team_list_invitations."
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    },
    {
      "id": "team_remove_member",
      "group": "team",
      "action": "remove-member",
      "method": "DELETE",
      "path": "/team/members/{id}",
      "summary": "Remove Team Member",
      "description": "Removes a member from the store: they lose access to it at once, and their pending invitations to the store are cancelled. Takes the membership's `id` from `GET /team/members`, not the user id. Only a key of an owner of the store may call it. Refused with `TEAM_CANNOT_REMOVE_SELF` for the membership of the user the key belongs to, `TEAM_OWNER_NOT_REMOVABLE` for an owner, and `TEAM_MEMBER_NOT_FOUND` for an id the store does not have. It needs the approval of the key's owner, whatever the key's confirmation setting: the first call changes nothing and answers 412 `APPROVAL_REQUIRED` with a preview naming the person and `data.details.approval.url`, a Louez page where the key's owner, signed in, approves or refuses within 24 hours. `GET /handoffs/{id}`, with the approval's id, says where it stands; read it every 30 seconds or more. Once it is approved, the same request with the approval's id in `Louez-Confirmation` carries it out, once, within an hour and while the store is still as the preview showed. The operation's own refusals (a record not found, a balance exceeded) answer first, so an approval error comes only for a request that is otherwise still valid. A refusal answers 409 `APPROVAL_DECLINED`. For 412 `APPROVAL_INVALID`, check `details.reason` before retrying: `used` means the action already ran; `approver_not_allowed` means someone allowed must act in Louez; `expired` or `state_changed` requires a new preview, requested without `Louez-Confirmation`; `other_request` requires this request's approval, or a new approval. Too many approval requests answers 429 `APPROVALS_FULL`, with `Retry-After`. The guide's \"Approvals\" section describes each answer. Returns the membership's `id`, the member's `userId` and `email`. `links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.",
      "pathParams": [
        {
          "name": "id",
          "flag": "id",
          "kind": "string",
          "required": true,
          "description": "The membership's id, from team_list_members (not the user id)."
        }
      ],
      "query": [],
      "body": null,
      "idempotent": true,
      "confirmation": true
    }
  ]
};
