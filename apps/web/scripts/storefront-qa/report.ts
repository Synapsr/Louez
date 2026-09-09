import type { qaStores, QaCase } from "./scenarios";

interface Report {
  createdAt: string;
  snapshotAt: string;
  revision: string;
  dirtyFiles: number;
  dates: { start: string; end: string; season: string; seasonEnd: string; closureEnd: string };
  mailUrl: string;
  fixtureUrl: string;
  stores: ((typeof qaStores)[number] & { url: string })[];
  cases: (QaCase & { url: string })[];
}
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function renderReport(report: Report): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Recette storefront Louez</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1200px;margin:auto;padding:24px;color:#18202c;background:#f7f8fa}h1{font-size:32px}a{color:#174bb0}nav,.controls{display:flex;flex-wrap:wrap;gap:16px;margin:20px 0}article{background:white;border:1px solid #dce0e6;border-radius:10px;padding:20px;margin:14px 0}h2{margin:0;font-size:19px}.meta{color:#526070;font-size:14px}label{display:block}input,select,button,textarea{font:inherit;padding:8px;border:1px solid #a8b2bf;border-radius:5px}textarea{display:block;width:95%;margin-top:8px}details{margin:14px 0}.warning{padding:16px;background:#fff1d6;border-left:4px solid #a76a00}article[data-level=external]{border-left:4px solid #a76a00}button{cursor:pointer}.stores{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.store{background:white;padding:14px;border:1px solid #dce0e6;border-radius:8px}</style>
<h1>Recette du storefront</h1><p>${report.stores.length} boutiques · ${report.cases.length} scénarios · données fictives</p>
<p class="warning">Les données sont préparées, pas automatiquement validées. Stripe et Tulip sont simulés localement. Une réussite ici ne valide pas les services réels, les webhooks, 3DS ou Stripe Elements. Les cas « externe » restent à vérifier dans une sandbox dédiée.</p>
<p class="meta">Sources copiées le ${escape(report.snapshotAt)} · commit ${escape(report.revision.slice(0, 10))} + ${report.dirtyFiles} fichiers modifiés. Données créées le ${escape(report.createdAt)}.</p>
<nav><a href="${report.mailUrl}" target="_blank" rel="noopener">Boîte email de test</a><a href="${report.fixtureUrl}" target="_blank" rel="noopener">Simulateurs et erreurs</a><a href="https://app.louez-qa.localify" target="_blank" rel="noopener">Dashboard</a></nav>
<p>Client : <strong>client@example.test</strong> · Propriétaire : <strong>owner@example.test</strong>. Les codes de connexion arrivent dans la boîte email. Utiliser uniquement des adresses <strong>@example.test</strong>.</p>
<p>Période stock : ${escape(report.dates.start)} → ${escape(report.dates.end)}. Haute saison : ${report.dates.season} → ${report.dates.seasonEnd}. Fermeture : ${report.dates.season} → ${report.dates.closureEnd}. Pour les autres parcours, choisir une période disponible différente.</p>
<details><summary>Ouvrir une boutique ou vider son panier</summary><div class="stores">${report.stores.map((s) => `<div class="store"><a target="_blank" rel="noopener" href="${s.url}">${escape(s.name)}</a><br><span class="meta">${s.count} produits préparés</span><br><a target="_blank" rel="noopener" href="${s.url}/qa/reset.html">Vider le panier navigateur</a></div>`).join("")}</div></details>
<div class="controls"><label>Rechercher <input id="search" placeholder="Assurance, caution…"></label><label>Boutique <select id="store"><option value="">Toutes</option>${report.stores.map((s) => `<option value="${s.slug}">${escape(s.name)}</option>`).join("")}</select></label><button id="export">Exporter mes résultats JSON</button></div><p id="counts"></p>
${report.cases.map((c) => `<article data-id="${c.id}" data-store="${c.store}" data-level="${c.level}"><p class="meta">${c.id} · ${c.store} · ${c.level === "simulation" ? "Service simulé" : c.level === "external" ? "Externe — non disponible sans sandbox" : "Application réelle"}</p><h2>${escape(c.title)}</h2><p><a href="${escape(c.url)}" target="_blank" rel="noopener">Ouvrir le scénario ↗</a></p><p>${escape(c.steps)}</p><p><strong>Attendu :</strong> ${escape(c.expected)}</p><details><summary>Source du comportement</summary><code>${escape(c.source)}</code></details><label>Résultat <select class="result"><option>À tester</option><option>Validé</option><option>Anomalie</option><option>Bloqué</option></select></label><textarea aria-label="Notes ${c.id}" placeholder="Observations, navigateur, largeur d’écran…"></textarea></article>`).join("")}
<script>
const key='louez-qa-results-${report.createdAt}';let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
const cards=[...document.querySelectorAll('article')];const search=document.querySelector('#search'),store=document.querySelector('#store');
function counts(){document.querySelector('#counts').textContent=cards.filter(c=>!c.hidden).length+' scénarios affichés · '+Object.values(saved).filter(s=>s.result==='Validé').length+' validés manuellement'}
for(const card of cards){const id=card.dataset.id,select=card.querySelector('select'),notes=card.querySelector('textarea');if(saved[id]){select.value=saved[id].result;notes.value=saved[id].notes}function save(){saved[id]={result:select.value,notes:notes.value,at:new Date().toISOString(),viewport:[innerWidth,innerHeight],browser:navigator.userAgent};localStorage.setItem(key,JSON.stringify(saved));counts()}select.onchange=save;notes.onchange=save}
function filter(){for(const card of cards)card.hidden=Boolean((store.value&&card.dataset.store!==store.value)||!card.textContent.toLowerCase().includes(search.value.toLowerCase()));counts()}search.oninput=filter;store.onchange=filter;counts();
document.querySelector('#export').onclick=()=>{const blob=new Blob([JSON.stringify({fixtureVersion:${JSON.stringify(report.createdAt)},snapshot:${JSON.stringify(report.snapshotAt)},results:saved},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='recette-storefront.json';a.click();URL.revokeObjectURL(a.href)};
</script></html>`;
}
