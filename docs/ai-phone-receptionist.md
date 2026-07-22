# Répondeur téléphonique IA — Plan produit & technique

> **Statut** : 📋 Proposition (plan approfondi)
> **Objectif** : un numéro de téléphone que le client peut appeler et où une IA répond, parle des produits, vérifie les disponibilités et prend une réservation — dans la langue configurée par la boutique, au coût le plus optimisé possible, en consommant les **crédits IA** existants.

---

## 1. L'idée en une phrase

Le répondeur téléphonique **n'est pas une nouvelle brique à construire de zéro**. C'est un **nouveau canal « voix »** branché devant l'**agent IA qui existe déjà** dans Louez — le _conseiller IA du storefront_ — avec ses outils (`list_products`, `check_availability`, `record_qualification`…), son **système de crédits prépayés** (micro-crédits, plafond par conversation, auto-recharge) et sa configuration par boutique.

```
Aujourd'hui (texte) :   Widget chat  ──► Agent IA (Vercel AI SDK + outils) ──► Crédits IA
Demain (voix)      :   Appel tél.  ──► [STT ⇄ TTS] ──► le MÊME Agent IA ──────► Crédits IA
```

La quasi-totalité de la logique métier (catalogue, disponibilités, qualification, réservation, facturation en crédits) est **déjà écrite et testée**. Le projet consiste à **ajouter la couche téléphonie + parole** et à **étendre le compteur de crédits aux minutes audio**.

---

## 2. Ce qui existe déjà et qu'on réutilise tel quel

| Brique | Emplacement | Réutilisation pour la voix |
|--------|-------------|-----------------------------|
| **Agent IA à outils** | `apps/web/app/api/storefront/chat/route.ts` + `apps/web/lib/ai/advisor/` | ✅ Le cœur. Même `streamText` + `tools`. |
| **Outils métier** | `apps/web/lib/ai/advisor/tools.ts` | ✅ `list_products`, `get_product`, `check_availability`, `get_store_info`, `record_qualification` réutilisés. ♻️ `recommend_products`/`add_to_cart` (web) → remplacés par des outils voix. |
| **Disponibilités** | `getStorefrontAvailability` (`@louez/api/services`) | ✅ Valide déjà horaires + préavis. |
| **Prompt système** | `apps/web/lib/ai/advisor/system-prompt.ts` | ♻️ Variante « voix » (phrases courtes parlées, épellation, annonce IA). Déjà multilingue. |
| **Conversations & transcripts** | tables `ai_advisor_conversations` / `ai_advisor_messages` | ✅ On y ajoute le canal `phone` + métadonnées d'appel. Le journal/transcript du dashboard fonctionne déjà. |
| **Crédits IA prépayés** | `apps/web/lib/ai/advisor/credits.ts`, tables `ai_credits`, `ai_credit_debits`, `ai_credit_transactions` | ✅ Même portefeuille. ♻️ On étend le calcul de coût aux minutes audio. |
| **Tarification / métrage** | `apps/web/lib/ai/pricing.ts` (`runCostMicroUsd`, `getCreditCostBasisUsd`) | ♻️ On ajoute un coût `audio` (par seconde) au coût `tokens`. |
| **Auto-recharge & gate crédits** | `checkAdvisorCredits`, `maybeTriggerAutoTopup` | ✅ Réutilisés (gate avant de décrocher). |
| **Abstraction fournisseur (SMS)** | `apps/web/lib/sms/` (interface `SmsProvider`, factory, smspartner/twilio/vonage) | ✅ Modèle exact à copier pour une abstraction `VoiceProvider`. Et l'envoi SMS sert au récap post-appel. |
| **Réglages conseiller IA** | `apps/web/app/(dashboard)/dashboard/settings/ai-advisor/` | ♻️ On y ajoute une carte « Répondeur téléphonique ». |
| **Plans & droits** | `apps/web/lib/plans.ts` (`plan.features.aiAdvisor`, `areAiCreditsEnabled`) | ♻️ Nouveau droit `features.aiPhone`. |
| **i18n** | `apps/web/i18n/config.ts` — `fr` (défaut), `en`, `it`, `nl`, `pt`, `de`, `es`, `pl` | ✅ Sert de liste des langues configurables. |

**Conséquence stratégique** : l'effort d'ingénierie est concentré sur **1 point** — brancher un flux d'appel sur un agent texte existant — et non sur la reconstruction d'un assistant.

---

## 3. Expérience cible (intuitive et simple)

### 3.1 Côté client qui appelle

1. Le client compose le numéro de la boutique.
2. L'IA décroche **dans la langue configurée** avec une **annonce obligatoire** :
   > « Bonjour, vous êtes en relation avec l'assistant vocal automatisé de _{Boutique}_. Comment puis-je vous aider ? »
3. Conversation naturelle : « Vous avez une remorque dispo ce week-end ? » → l'IA vérifie (`check_availability`), propose, pose les questions de qualification du loueur (permis, caution…), **confirme les dates en les répétant**.
4. **Prise de réservation** : l'IA crée une réservation en attente et **envoie un SMS de récapitulatif + lien de confirmation/paiement** (via le fournisseur SMS déjà intégré).
5. Repli : « Je vous mets en relation avec la boutique » → transfert vers le numéro du loueur (optionnel), ou prise de message.

### 3.2 Côté loueur (activation en < 2 minutes)

Dans **Réglages → Assistant IA**, une nouvelle carte **« Répondeur téléphonique »** (même page que le conseiller, mêmes crédits) :

| Réglage | UX | Défaut |
|---------|----|--------|
| **Activer le répondeur** | Interrupteur | Off |
| **Numéro** | Bouton **« Obtenir un numéro »** (attribution en 1 clic) _ou_ **« Utiliser mon numéro »** (renvoi d'appel / portabilité) | — |
| **Langue de réponse** | Menu déroulant réutilisant `localeNames` + drapeaux | Langue de la boutique |
| **Voix** | 2-3 voix par langue, avec bouton d'écoute | Voix neutre par défaut |
| **Message d'accueil** | Texte libre optionnel (repli i18n) | Généré |
| **Que peut faire l'assistant ?** | Cartes radio : _Informer seulement_ / _Informer + prendre des réservations_ | Informer + réserver |
| **Quand répond-il ?** | _24/7_ / _Uniquement hors horaires ou quand vous ne décrochez pas_ (mode **débordement**) | Hors horaires |
| **Transfert vers un humain** | Numéro optionnel | Vide |
| **Enregistrement des appels** | Interrupteur d'_opt-in_ (voir §8) | Off |
| **Crédits IA** | Section crédits **déjà existante** (le même solde finance la voix) | — |
| **Journal des appels** | Section conversations **déjà existante** (transcripts) | — |

> 💡 **La fonctionnalité « killer » simple** : le **mode débordement** (« répond quand vous ne décrochez pas / hors horaires »). Zéro friction, valeur immédiate : plus aucun appel manqué, sans changer les habitudes du loueur.

---

## 4. Architecture technique

### 4.1 Vue d'ensemble (recommandation MVP)

```
                         ┌─────────────────────────────────────────────┐
   Appel entrant (PSTN)  │  Twilio (numéro FR + ConversationRelay)      │
   ───────────────────►  │  • STT (Deepgram FR) • TTS (ElevenLabs FR)   │
                         │  • VAD / barge-in / tour de parole           │
                         └───────────────┬──────────────(WebSocket)─────┘
                                         │ transcript (texte)  ▲ réponse (texte)
                                         ▼                     │
                 ┌───────────────────────────────────────────────────────┐
                 │  apps/web — nouvelle route /api/voice/relay (WS)        │
                 │  1. Résout la boutique via le numéro appelé            │
                 │  2. Gate : plan.features.aiPhone + crédits (hold)      │
                 │  3. Appelle l'AGENT IA EXISTANT (Vercel AI SDK)        │
                 │       system = prompt « voix » + langue configurée     │
                 │       tools = outils voix (réutilisés + adaptés)       │
                 │  4. Persiste la conversation (canal = 'phone')         │
                 │  5. À la fin : métrage crédits (audio_sec + tokens)    │
                 └───────────────────────────────────────────────────────┘
                                         │
                                         ▼
              Drizzle / MySQL  ◄──►  produits, dispo, réservations, crédits
                                         │
                                         ▼
                          SMS de récap (fournisseur SMS existant)
```

**Pourquoi ConversationRelay pour le MVP** : c'est **l'intégration au plus petit diff** depuis l'agent texte actuel. Twilio gère STT + TTS + détection de fin de parole + interruption (barge-in) et **streame du texte** ; on répond en **texte**. L'agent `streamText` avec ses `tools` tourne **inchangé**. On n'écrit **aucun** code de buffer audio. La langue par boutique = un simple flag de session (locale STT/TTS + voix).

### 4.2 Les deux boucles possibles (et pourquoi on commence en « cascade »)

| Approche | Comment | Coût /min (gros de gamme) | Latence | Réutilise l'agent texte ? |
|----------|---------|---------------------------|---------|---------------------------|
| **Cascade** (STT → LLM texte → TTS) — _recommandée_ | ConversationRelay ou LiveKit orchestrent la parole ; **notre agent texte** est le cerveau | ~€0.03 (self-host) à ~€0.08 (ConversationRelay) | ~1–3 s | ✅ **Oui, verbatim** |
| **Speech-to-speech natif** (Gemini Live / Nova Sonic) | Le modèle « entend » et « parle » directement | ~€0.01–0.02 (à confirmer) | < 1 s | ❌ Il faut réécrire l'agent en audio natif |

On **démarre en cascade** : réutilisation immédiate de tout l'existant, contrôle/observabilité maximum, métrage token par token. On garde le **speech-to-speech en optimisation Phase 3** si la latence ou le coût l'exigent — la même « interface texte + outils » se reporte.

---

## 5. Choix de la stack voix (state of the art, coût optimisé — 2026)

> Prix de gros indicatifs (recherche 2026, avant marge). **À reconfirmer sur les pages tarifaires officielles avant contractualisation**, notamment le tarif entrant France exact.

### 5.1 Recommandation par phase

- **MVP (Phase 1) — le plus rapide, contrôle maximal** :
  **Twilio (numéro FR + ConversationRelay)** + **notre agent Vercel AI SDK** + modèle **économique (classe Claude Haiku / GPT-4o-mini)**.
  STT/TTS français **inclus** dans ConversationRelay (Deepgram + ElevenLabs).
  → **≈ €0.07–0.10/min tout compris**, numéro FR **≈ €1/mois**.

- **Optimisation coût (Phase 3) — le moins cher** :
  Numéro **Telnyx** (~€1/mois, entrant dès ~€0.002/min) + **LiveKit Agents auto-hébergé** (open-source, SIP natif, pas de taxe par minute) + **Deepgram Nova-3** (STT FR) + notre agent + **Cartesia Sonic** ou **Azure Neural fr-FR** (TTS FR).
  → **≈ €0.03–0.05/min tout compris**. Contrepartie : on gère l'ops et le SDK JS/TS est moins mûr que le Python.

- **Alternative latence/coût (à évaluer)** :
  **Google Gemini 2.5 Flash (audio natif)** ou **Amazon Nova Sonic** (voix FR natives) sur une jambe SIP Telnyx. Sub-seconde, coût comparable, **mais** implique de réécrire l'agent en audio natif (perte de la réutilisation directe).

### 5.2 À éviter pour un coût optimisé

- Plateformes **fermées tout-en-un** (Bland ~€0.10–0.13/min) : impossible d'optimiser le modèle/voix FR.
- **Builders premium** (Synthflow ~€0.14–0.34/min).
- `gpt-4o-realtime-preview` (~€0.22–0.28/min) : trop cher.

### 5.3 Composants (repères de prix)

| Couche | Option retenue | Prix repère | Source |
|--------|----------------|-------------|--------|
| Numéro FR (DID) | Telnyx / Twilio | ~€1/mois (Telnyx) · €1–3 (Twilio, à confirmer) | telnyx.com/phone-numbers/france |
| Transport entrant | Telnyx / Twilio | €0.002 (Telnyx) · ~€0.008/min (Twilio) | telnyx.com/pricing/voice-api |
| Orchestration STT+TTS+tour de parole | ConversationRelay | €0.07/min (LiveKit auto-hébergé ≈ €0.01) | twilio.com/docs/voice/conversationrelay |
| STT FR (si cascade maison) | Deepgram Nova-3 | ~€0.005–0.006/min | deepgram.com/pricing |
| TTS FR (si cascade maison) | Cartesia Sonic / Azure fr-FR | ~€0.014/min | — |
| LLM (agent, surtout en écoute) | Haiku / GPT-4o-mini | ~€0.005–0.01/min | — |

---

## 6. Modèle de coût & intégration aux crédits IA

### 6.1 Le principe : le même portefeuille, deux compteurs

Le système actuel facture une conversation texte au **coût réel des tokens**, converti en crédits via `AI_CREDIT_COST_BASIS_USD` (le montant USD qui vaut **1 crédit**), avec un **plafond de 1 crédit par conversation** (`recordAdvisorRunDebit`).

Pour la voix, le coût est **dominé par les minutes audio**, pas par les tokens. On **étend le calcul** à deux quantités mesurées par appel :

```
coût_appel_usd = (audio_secondes × tarif_audio_par_seconde)      ← téléphonie + STT + TTS
               + (tokens_in × prix_in + tokens_out × prix_out)   ← LLM (déjà mesuré, usage AI SDK)

crédits_débités = ceil( coût_appel_usd × marge / AI_CREDIT_COST_BASIS_USD )
```

- **Nouveaux `env`** (mêmes conventions que la tarification actuelle) : `AI_VOICE_AUDIO_USD_PER_MIN` (tarif audio mélangé de la stack retenue), et réutilisation des `AI_ADVISOR_*_USD_PER_MTOK` pour les tokens.
- **Marge** : appliquer un multiplicateur (ex. ×2–3) pour absorber la dérive des tarifs et dégager la marge (comme aujourd'hui, jamais en dur dans le repo — via env).

### 6.2 Autoriser puis régulariser (authorize-then-settle)

1. **Au décrochage** : `checkAdvisorCredits` (existe déjà) + **réservation d'un hold** estimé (ex. 8 min au tarif haut). Si le solde prépayé + inclus est insuffisant → l'IA ne décroche pas (message neutre ou renvoi direct vers le loueur). Le hold **borne le risque** d'un appel qui dérape.
2. **En fin d'appel** : calcul du **coût réel** (audio + tokens) → **débit réel**, libération du solde du hold, arrondi au crédit. Réutilise `ai_credit_debits` (idempotent via `dedupKey = call:<callId>`).
3. **Plafond par appel** : nouveau plafond **configurable** (le plafond « 1 crédit / conversation » actuel est adapté au texte ; un appel vocal coûte davantage). Défaut prudent (ex. quelques crédits) pour éviter les appels-fleuves coûteux.
4. **Auto-recharge** : `maybeTriggerAutoTopup` réutilisé tel quel.

### 6.3 Ordre de grandeur d'un appel de réservation (3–4 min)

| Scénario stack | Coût de gros | Ce qu'on facture (avec marge) |
|----------------|--------------|-------------------------------|
| **LOW** (cascade auto-hébergée) | €0.08–0.11 | ~quelques crédits |
| **TYPICAL** (ConversationRelay, MVP) | €0.25–0.33 | à calibrer via `AI_CREDIT_COST_BASIS_USD` |
| **HIGH** (ElevenLabs premium + modèle haut de gamme) | €0.41–0.55 | — |

> Le nombre exact de crédits par appel se **pilote entièrement par env** (`AI_CREDIT_COST_BASIS_USD`, tarifs audio/tokens, marge) — aucune valeur commerciale n'est figée dans le code, exactement comme la tarification texte actuelle.

### 6.4 Transparence

Chaque appel stocke ses **lignes de coût** (secondes audio, tokens, coût calculé, crédits débités) → réconciliation + affichage d'un détail d'usage lisible au loueur dans le journal des appels.

---

## 7. Modèle de données (changements)

Additif et rétro-compatible :

- **`ai_advisor_conversations`** (extension) :
  - `channel` : `enum('web','phone')` (défaut `'web'`) — le transcript/dashboard existants marchent déjà.
  - `caller_phone`, `provider_call_id`, `duration_seconds`, `audio_cost_micro_usd`.
- **`ai_credit_debits`** (extension) : `audio_seconds`, `audio_cost_micro_usd` (les colonnes tokens existent déjà) ; `dedupKey` passe à `call:<callId>` pour la voix.
- **`store_phone_numbers`** (nouvelle) : `store_id`, `e164`, `provider` (`twilio|telnyx`), `provider_number_id`, `status` (`active|pending|released`), `capabilities`. Permet 1 numéro par boutique (multi-tenant).
- **`AiPhoneSettings`** (nouveau type, `packages/types/src/store.ts`, à côté d'`AiAdvisorSettings`) :
  ```ts
  interface AiPhoneSettings {
    enabled: boolean
    language: Locale            // langue de réponse configurée
    voiceId?: string
    greeting?: string
    canTakeReservations: boolean
    answerMode: 'always' | 'after_hours' | 'on_no_answer'  // mode débordement
    transferNumber?: string
    recordCalls: boolean        // opt-in (RGPD)
  }
  ```
- **Plan** : `features.aiPhone: boolean` dans `PlanFeatures` (droit d'accès).
- **`env`** : `VOICE_PROVIDER`, `TWILIO_*` / `TELNYX_*`, `AI_VOICE_AUDIO_USD_PER_MIN`, `AI_PHONE_ENABLED`. Le répondeur reste **invisible tant que non configuré** (comme le conseiller aujourd'hui).

---

## 8. Adaptation des outils de l'agent pour la voix

L'agent voix appelle `createPhoneAgentTools(ctx)` — dérivé de `createAdvisorTools` :

| Outil | Statut | Note voix |
|-------|--------|-----------|
| `list_products`, `get_product`, `check_availability`, `get_store_info` | ✅ Réutilisés | Résultats **résumés à l'oral** (pas de cartes). |
| `record_qualification` | ✅ Réutilisé | Toujours écrit faits + validation dans la conversation. |
| `recommend_products` (cartes web) | ♻️ Remplacé | Recommandation **parlée** ; option `send_sms_recap` avec liens. |
| `add_to_cart` (client web) | ♻️ Remplacé | **`create_reservation_hold`** : crée une réservation `pending` via le service réservations existant (pas de panier navigateur). |
| — | ➕ Nouveau | **`send_sms_recap`** : SMS récap + lien confirmation/paiement (fournisseur SMS existant). |
| — | ➕ Nouveau | **`transfer_to_human`** : transfert SIP/DTMF vers `transferNumber` (désactivé par défaut, voir toll fraud). |
| — | ➕ Nouveau | **`take_message`** : laisse un message/callback si l'IA ne peut pas conclure. |

**Prompt système « voix »** (`buildPhoneAgentSystemPrompt`) — variante du prompt conseiller :
- Répond **dans la langue configurée** (`settings.language`), pas la locale navigateur.
- **Phrases courtes, parlées**, une question à la fois ; **répète et confirme** dates/nombres ; épelle si besoin (noms, e-mails).
- **Annonce IA obligatoire** dès la première phrase (EU AI Act, §9).
- Réutilise le durcissement anti-injection et l'injection de la guidance produit (`products.aiContext`) et du `storeContext`.

---

## 9. Conformité, sécurité, fraude

| Sujet | Exigence | Implémentation |
|-------|----------|----------------|
| **EU AI Act — art. 50 (transparence)** | Informer clairement l'appelant qu'il parle à une **IA**. | Phrase d'accueil dès le décrochage (dans la langue configurée). Non négociable, coût nul. |
| **RGPD / CNIL — enregistrement & données** | Base légale + information + durée de conservation limitée si on enregistre/transcrit. | Enregistrement **opt-in** par boutique (défaut Off). Annonce si activé. Rétention minimale, **hébergement/traitement UE** (co-localiser STT/LLM/TTS en région UE). **DPA** avec chaque sous-traitant (Twilio/Deepgram/ElevenLabs/LLM). PII réservation minimisée. Voie de suppression. |
| **ARCEP — numérotation FR** | KYC / preuve d'établissement pour un DID géographique ; portabilité fixe encadrée. | Prévoir le KYC fournisseur avant de promettre une activation instantanée par boutique. Portabilité d'un fixe pro : **≈ 7 jours ouvrés** (objectif 3). |
| **Fraude télécom (toll fraud)** | Un répondeur qui peut composer vers l'extérieur est une surface d'attaque. | **Sortant désactivé par défaut** ; `transfer_to_human` restreint au numéro du loueur ; **cap de concurrence par boutique** ; rate-limit (réutiliser `checkAdvisorRateLimit`) ; hold prépayé qui borne la casse ; alertes sur anomalie de dépense. |
| **Latence (< 800 ms/tour idéal)** | La cascade ajoute ~1,5–3 s ; l'audio 8 kHz dégrade le STT. | Streamer la 1re phrase en TTS immédiatement (découpage en phrases), LLM rapide, **tester la latence FR sur le vrai chemin SIP** avant lancement ; bascule audio-natif possible si l'UX en pâtit. |

---

## 10. Plan de déploiement par phases

### Phase 0 — Preuve de concept (spike, ~quelques jours)
- Twilio ConversationRelay + WebSocket → agent existant, **un numéro FR de test**, français, sans crédits.
- But : valider la latence FR de bout en bout et la qualité STT/TTS sur le vrai chemin SIP.

### Phase 1 — MVP activable
- Abstraction `VoiceProvider` (calquée sur `SmsProvider`) + provider Twilio.
- Route `/api/voice/relay` (WS) : résolution boutique par numéro, gate plan+crédits (hold), agent voix, persistance `channel='phone'`.
- **Outils voix** (`create_reservation_hold`, `send_sms_recap`) + prompt voix + **annonce IA**.
- **Métrage crédits audio+tokens** (authorize-then-settle) + plafond par appel.
- **Carte de réglages** « Répondeur téléphonique » : activer, **obtenir un numéro**, **langue**, mode réponse (**débordement**), que peut faire l'IA.
- Journal des appels (transcripts existants) + détail de coût.
- Droit `features.aiPhone`.

### Phase 2 — Confort & robustesse
- Choix de **voix** + écoute, message d'accueil personnalisé.
- **Transfert vers humain**, prise de message/callback.
- **Enregistrement opt-in** conforme CNIL (stockage UE, rétention, suppression).
- **Portabilité / renvoi** du numéro existant du loueur.
- Alertes anti-fraude, tableaux d'usage.

### Phase 3 — Optimisation coût & croissance
- Migration de l'orchestration vers **LiveKit auto-hébergé** (ou Telnyx) pour supprimer la taxe €0.07/min → **~€0.03/min**.
- Évaluer **audio natif** (Gemini Live / Nova Sonic) pour la latence.
- Rappels sortants (avec garde-fous stricts), analytics de conversion appel → réservation.

---

## 11. Risques & décisions à trancher

| Décision | Options | Reco |
|----------|---------|------|
| Numéro par boutique | 1 DID dédié / boutique **vs** numéro partagé + routage | **1 DID par boutique** (simple, marque, multi-tenant naturel). |
| Fournisseur MVP | Twilio ConversationRelay **vs** managé (Vapi/Retell) **vs** self-host (LiveKit) | **Twilio ConversationRelay** (plus petit diff, contrôle, coût correct), puis LiveKit en Phase 3. |
| Boucle voix | Cascade **vs** audio natif | **Cascade** d'abord (réutilise l'agent), audio natif en option. |
| Modèle LLM voix | Haiku / GPT-4o-mini vs plus gros | **Économique** (surtout en écoute) — piloté par `AI_ADVISOR_MODEL`. |
| Enregistrement | Off / opt-in / on | **Opt-in** (défaut Off) pour la conformité. |

**Points à confirmer avant contractualisation** : tarif entrant **France** exact (Twilio/Telnyx), coût mensuel réel du DID FR, exigences **KYC ARCEP** par fournisseur, et prix **audio natif** Gemini/Nova (écarts constatés entre agrégateurs).

---

## 12. Estimation d'effort (indicative)

| Lot | Effort |
|-----|--------|
| Phase 0 (spike) | ~2–4 j |
| Phase 1 (MVP) | ~2–3 sem |
| Phase 2 | ~2–3 sem |
| Phase 3 | ~2–4 sem (selon self-host) |

Le MVP est **court** précisément parce que l'agent, les outils, les crédits et le dashboard **existent déjà** — on ajoute la couche téléphonie et le métrage audio.

---

## Annexe — Sources (recherche 2026, prix à revérifier)

- Twilio ConversationRelay — twilio.com/docs/voice/conversationrelay/best-practices ; tarifs voix FR — twilio.com/en-us/voice/pricing/fr
- Telnyx — telnyx.com/phone-numbers/france · telnyx.com/pricing/voice-api
- LiveKit Agents — docs.livekit.io/telephony/agents-integration · livekit.com/pricing
- Deepgram — deepgram.com/pricing · ElevenLabs Agents — elevenlabs.io/pricing/agents · Cartesia — texttolab.com/blog/cartesia-pricing · Azure TTS — texttolab.com/blog/azure-text-to-speech-pricing
- Gemini — ai.google.dev/gemini-api/docs/pricing · Amazon Nova Sonic — aws.amazon.com/about-aws/whats-new/2025/12/amazon-nova-2-sonic-real-time-conversational-ai
- Comparatif temps réel 2026 — apiscout.dev/guides/realtime-voice-ai-apis-comparison-2026
