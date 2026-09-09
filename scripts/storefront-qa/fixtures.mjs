import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const escape = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const page = (content) =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Simulateur de recette</title><style>body{max-width:700px;margin:60px auto;padding:20px;font:18px/1.5 system-ui}button,a{margin:8px;padding:12px;display:inline-block}aside{padding:20px;background:#fff1d6}</style><h1>Simulateur local Louez</h1><aside>Aucun paiement réel. Aucun contrat d’assurance réel. Les contrôles du fournisseur ne sont pas reproduits.</aside>${content}</html>`;

export function createFixtureServer(state, stateDir) {
  const storage = path.join(stateDir, "provider-state.json");
  const persisted = existsSync(storage)
    ? JSON.parse(readFileSync(storage, "utf8"))
    : { sessions: {}, contracts: {} };
  let tulipMode = "normal";
  const sessions = persisted.sessions;
  const contracts = persisted.contracts;
  const save = () =>
    writeFileSync(storage, JSON.stringify({ sessions, contracts }), { mode: 0o600 });
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${state.fixturePort}`);
    const json = (value, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const html = (content) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(content));
    };
    try {
      // Browser controls accept same-origin form posts only. API calls originate from the local SDK.
      if (req.headers.origin && req.headers.origin !== url.origin)
        return json({ error: "Origin refused" }, 403);
      if (url.pathname === "/")
        return html(
          `<h2>Assurance Tulip</h2><p>État courant : ${tulipMode}. Ce réglage touche toutes les boutiques de recette.</p><form method="post" action="/mode"><button name="mode" value="normal">Normal</button><button name="mode" value="error">Erreur 503</button><button name="mode" value="slow">Lent (8 s)</button></form><p>Le simulateur Stripe s’ouvre après validation du checkout.</p>`,
        );
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) throw new Error("Request too large");
      }
      if (url.pathname === "/mode" && req.method === "POST") {
        const mode = new URLSearchParams(body).get("mode");
        if (!["normal", "error", "slow"].includes(mode))
          return json({ error: "Invalid mode" }, 400);
        tulipMode = mode;
        res.writeHead(303, { Location: "/" });
        return res.end();
      }
      if (url.pathname.startsWith("/google/")) {
        const place = (far) => ({
          id: far ? "qa-far" : "qa-near",
          formattedAddress: far
            ? "1 rue de la Recette, 77000 Melun, France"
            : "10 rue de la Paix, 75002 Paris, France",
          location: { latitude: far ? 48.54 : 48.87, longitude: far ? 2.66 : 2.33 },
          addressComponents: [
            { types: ["street_number"], longText: far ? "1" : "10" },
            { types: ["route"], longText: far ? "rue de la Recette" : "rue de la Paix" },
            { types: ["locality"], longText: far ? "Melun" : "Paris" },
            { types: ["postal_code"], longText: far ? "77000" : "75002" },
            { types: ["country"], longText: "France", shortText: "FR" },
          ],
        });
        if (url.pathname.endsWith("places:autocomplete")) {
          return json({
            suggestions: [false, true].map((far) => {
              const p = place(far);
              return {
                placePrediction: {
                  placeId: p.id,
                  text: { text: p.formattedAddress },
                  structuredFormat: {
                    mainText: { text: far ? "QA hors zone — 45 km" : "QA proche — 5 km" },
                    secondaryText: { text: p.formattedAddress },
                  },
                },
              };
            }),
          });
        }
        if (url.pathname.endsWith("places:searchText"))
          return json({ places: [place(/loin|melun|hors/i.test(body))] });
        if (url.pathname.includes("/places/")) return json(place(url.pathname.endsWith("qa-far")));
        if (url.pathname.endsWith("v2:computeRoutes")) {
          const payload = JSON.parse(body);
          return json({
            routes: [
              {
                distanceMeters: payload.destination.location.latLng.latitude < 48.7 ? 45000 : 5000,
              },
            ],
          });
        }
        return json({ status: "ZERO_RESULTS", results: [] });
      }
      if (url.pathname.startsWith("/tulip/")) {
        if (tulipMode === "error") return json({ message: "QA: Tulip indisponible" }, 503);
        if (tulipMode === "slow") await new Promise((resolve) => setTimeout(resolve, 8000));
        if (url.pathname.startsWith("/tulip/renters/"))
          return json({
            renter: {
              uid: url.pathname.split("/").at(-1),
              options: {
                LCD: true,
                LMD: true,
                LLD: true,
                inclusion: false,
                products: [{ product_type: "bike" }],
              },
            },
          });
        if (url.pathname === "/tulip/products")
          return json({
            products: JSON.parse(readFileSync(path.join(stateDir, "manifest.json"), "utf8"))
              .tulipProducts,
          });
        if (url.pathname === "/tulip/contracts" && req.method === "POST") {
          const payload = JSON.parse(body);
          const contract = {
            ...payload,
            cid: `qa-${randomUUID()}`,
            price: Object.keys(payload.products || {}).length * 4.5,
            status: "active",
          };
          if (!url.searchParams.has("preview")) {
            contracts[contract.cid] = contract;
            save();
          }
          return json({ contract });
        }
        const cid = url.pathname.split("/")[3];
        if (cid && contracts[cid]) return json({ contract: contracts[cid] });
        return json({ message: "Unsupported Tulip fixture request" }, 501);
      }
      if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
        const params = new URLSearchParams(body);
        const id = `cs_test_qa_${randomUUID().replaceAll("-", "")}`;
        let total = 0;
        for (let n = 0; params.has(`line_items[${n}][quantity]`); n++)
          total +=
            Number(params.get(`line_items[${n}][quantity]`)) *
            Number(params.get(`line_items[${n}][price_data][unit_amount]`));
        const metadata = Object.fromEntries(
          [...params]
            .filter(([key]) => key.startsWith("metadata["))
            .map(([key, value]) => [key.slice(9, -1), value]),
        );
        const session = {
          id,
          object: "checkout.session",
          status: "open",
          payment_status: "unpaid",
          payment_intent: `pi_qa_${id}`,
          customer: `cus_qa_${id}`,
          amount_total: total,
          currency: params.get("line_items[0][price_data][currency]") || "eur",
          metadata,
          expires_at: Math.floor(Date.now() / 1000) + 1800,
          url: `${url.origin}/checkout/${id}`,
          success_url: params.get("success_url"),
          cancel_url: params.get("cancel_url"),
        };
        sessions[id] = session;
        save();
        return json(session);
      }
      if (url.pathname.startsWith("/v1/checkout/sessions/")) {
        const session = sessions[url.pathname.split("/")[4]];
        return session ? json(session) : json({ error: { message: "Unknown QA session" } }, 404);
      }
      if (url.pathname.startsWith("/v1/payment_intents/")) {
        const id = url.pathname.split("/")[3];
        const session = Object.values(sessions).find((s) => s.payment_intent === id);
        return session
          ? json({
              id,
              object: "payment_intent",
              status: session.payment_status === "paid" ? "succeeded" : "requires_payment_method",
              amount: session.amount_total,
              currency: session.currency,
              customer: session.customer,
              payment_method: `pm_qa_${session.id}`,
              latest_charge: `ch_qa_${session.id}`,
            })
          : json({ error: { message: "Unknown QA payment intent" } }, 404);
      }
      if (url.pathname.startsWith("/checkout/")) {
        const id = url.pathname.split("/")[2];
        const session = sessions[id];
        if (!session) return json({ error: "Unknown session" }, 404);
        if (req.method === "POST") {
          const action = new URLSearchParams(body).get("action");
          if (action === "decline")
            return html(
              '<p>Carte refusée (simulation). La réservation reste impayée.</p><button onclick="history.back()">Réessayer</button>',
            );
          if (!["success", "cancel", "unpaid"].includes(action))
            return json({ error: "Unknown action" }, 400);
          if (action === "success") {
            session.payment_status = "paid";
            session.status = "complete";
            save();
          }
          const destination = new URL(
            (action === "cancel" ? session.cancel_url : session.success_url).replace(
              "{CHECKOUT_SESSION_ID}",
              id,
            ),
          );
          if (
            destination.protocol !== "https:" ||
            !destination.hostname.endsWith(".louez-qa.localify")
          )
            return json({ error: "Non-QA return URL refused" }, 400);
          res.writeHead(303, { Location: destination.toString() });
          return res.end();
        }
        return html(
          `<p>Montant calculé par Louez : <strong>${session.amount_total / 100} ${escape(session.currency.toUpperCase())}</strong></p><p>Réservation : ${escape(session.metadata.reservationId)}</p><form method="post"><button name="action" value="success">Réussir</button><button name="action" value="decline">Refuser</button><button name="action" value="cancel">Annuler</button><button name="action" value="unpaid">Retour sans paiement</button></form>`,
        );
      }
      return json({ error: { message: `Unsupported QA endpoint: ${url.pathname}` } }, 501);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Fixture error" }, 500);
    }
  });
}
