# Account deletion and legal retention

Louez deletes an account from its active systems when the owner confirms the request. This includes every Store owned solely by that account, its operational data, uploaded files, sessions, memberships, and connected services.

An owner cannot delete an account while one of their Stores still has another member. They must remove those members first or arrange a transfer with support. Stores where the account is only a member are left intact; Louez removes the departing membership.

## Confirmation flow

Before the irreversible confirmation, Louez asks why the owner is leaving. The
answer is optional and limited to a short predefined list. There is no free-text
field. Louez stores only one global counter per reason, with no user ID, Store
ID, response timestamp, or individual response row. The selected counter is
incremented in the same transaction as a successful purge; an abandoned or
failed deletion is not counted.

Platform accounts receive a single-use email link. Opening the link is not destructive: the signed-in owner must confirm once more on the Louez page. The token stays in the URL fragment, is moved to session storage, and is never sent in a referrer or server log. Standalone accounts confirm with their current password.

Before sending a platform email, Louez checks that the legal archive and the configured processor-erasure credentials are available. The final deletion starts a database transaction, locks and rechecks the owned Stores and their memberships, then removes external resources before archiving the legally required records and purging the active database. If the locked check finds a shared Store, no external cleanup starts.

## What is retained

Louez does not keep a dormant Store, user profile, product catalogue, customer list, reservation history, or analytics profile after deletion.

Invoices issued or received by a merchant through a Store are deleted with the Store. The owner must export any documents they are required to keep before deleting the account.

On Louez Cloud, inside the purge transaction, Louez also queues a closing snapshot of each deleted Store and of each reservation it may still be billed for, for the billing service. It first locks those reservations and their payments, and the Store rows its snapshot reads, so a payment or a plan change recorded during the deletion is in the snapshot. They carry no name, contact, address or renter data, and the Store snapshot drops its slug and owners.

Louez retains only billing records for transactions where Louez itself is the supplier or regulated party, such as platform invoices and completed SMS or AI-credit purchases. Each record is copied into `legal_retention_records`, encrypted with AES-256-GCM, detached from the deleted user and Store identifiers, and assigned an expiry ten years after the relevant financial year closes. The daily cron permanently deletes records after that date.

Access to the archive must be restricted to authorised legal or accounting operations. `LEGAL_ARCHIVE_ENCRYPTION_KEY` must be held outside the database and included in the operator's key rotation and recovery procedures. `LEGAL_ARCHIVE_FISCAL_YEAR_END` records Louez's financial year end as `MM-DD`; it defaults to `12-31`.

This policy follows the French ten-year accounting retention period measured from the financial-year closing date. Recheck it with Louez's accountant or counsel if Louez's role, billing model, or fiscal year changes.

## Customer profile data and custom fields

Beyond contact and billing details, a Customer record can hold:

- a birth date, the origin declared by the merchant (how the Customer heard about the Store, with an optional free-text precision) and social links;
- the creation channel (`dashboard`, `storefront`, `marketplace`, `import`, `api`, `ai`), written by the code path that created the record and never typed by anyone;
- Custom fields defined by each Store: identity or tax numbers, driving licence, emergency contact, sizes and the like. Louez does not know in advance what a Store collects; the Store remains the controller of that choice. Field templates deliberately leave out national identifiers whose collection is restricted for this purpose (French social security number, Belgian national register number, Dutch BSN).

A Store flags a Custom field as **sensitive** when its value should not circulate. The flag changes four things:

- the value is masked on the Customer record (last four characters, revealed on demand) and its input is obscured in OpenReplay session recordings;
- the customers export leaves the column out unless the Store owner ticks an explicit opt-in for that download;
- the AI assistant and the MCP server never read the value back: they report that it is on file and withheld. They may still write it when the merchant dictates it;
- it does not hide the value from the contract: a field flagged "show on contract" is printed in full on the PDF, which is the merchant's explicit choice. A generated contract keeps the values it was printed with.

Custom field values are searchable only through a normalised copy (`search_value`) scoped to the Store, and only for fields the Store made searchable.

All of it is erased with its owner. Deleting a Customer removes their custom field values, sessions and communication preferences in the same transaction as the record itself (a Customer with reservations cannot be deleted). Deleting an account purges `customer_field_values`, `customer_field_targets`, `customer_field_definitions` and `reservation_item_details` (item-scope values and participant names recorded per rented unit) with every Store it solely owns; a reservation line removed from a reservation takes its unit details with it. Archiving a Custom field hides it and keeps the values already collected; deleting it permanently removes every value held for it, on Customer records and on reservation units alike.

## External processors

Deletion is fail-closed. If Louez knows about a provider-side resource and cannot remove or revoke it, the local database remains intact so the owner can retry safely. One exception: a Louez-created Google calendar that Google no longer lets Louez reach (the owner revoked access, or the token expired for good) lives in the owner's own Google account, so deletion goes on, the deletion dialog tells the owner they can remove it from Google Calendar, and the server logs it.

| Processor             | Deletion action                                                                                                             | Required private configuration                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| S3-compatible storage | Delete every object under the Store and user prefixes                                                                       | Existing S3 credentials                                                       |
| Stripe Billing        | Cancel subscriptions immediately, then delete customers                                                                     | `STRIPE_SECRET_KEY`                                                           |
| Stripe Connect        | Delete the connected account when Stripe permits it; a live Standard account must first be disconnected in Stripe Dashboard | `STRIPE_SECRET_KEY`                                                           |
| Twilio                | Release provisioned numbers before deleting bindings                                                                        | Existing Twilio credentials                                                   |
| Google Calendar       | Delete Louez-created calendars and revoke OAuth tokens; a calendar Google no longer lets Louez reach stays with its owner   | Existing Google Calendar OAuth credentials and `INTEGRATION_ENCRYPTION_KEY`   |
| Google sign-in        | Revoke access and refresh tokens                                                                                            | Stored Better Auth credentials                                                |
| SuperPDP              | Revoke OAuth tokens; statutory invoice retention still applies at each regulated party                                      | Existing SuperPDP OAuth credentials and `INTEGRATION_ENCRYPTION_KEY`          |
| Tulip                 | Delete products created and mapped by Louez; existing insurance contracts follow Tulip's contractual retention rules        | `TULIP_API_KEY`                                                               |
| PostHog               | Delete the person and queue deletion of associated events                                                                   | `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`, optional `POSTHOG_API_HOST` |
| Gleap                 | Delete the identified contact and their conversations                                                                       | `GLEAP_API_TOKEN`                                                             |
| OpenReplay            | Schedule deletion of the identified user, sessions, events, metadata, and recordings                                        | `OPENREPLAY_API_URL` (public API base), `OPENREPLAY_ORGANIZATION_API_KEY`     |

When Louez reports to the billing service (`LOUEZ_BILLING=cloud` with `BILLING_SERVICE_URL`), it leaves Stripe Billing customers to that service, which bills the final statement and then closes or anonymises the customer after its retention period. Louez still cancels the customer's plan subscription and removes the Stripe Connect accounts.

PostHog event deletion and OpenReplay recording deletion are asynchronous provider jobs. Operators should monitor provider failures and their normal job queues. Webhook-only Discord notifications cannot be recalled because Louez does not retain provider message IDs; they must not contain Store operational data beyond the notification's stated purpose.

## Backups and restores

Infrastructure backups are outside the application database purge. Operators must define a short, documented backup expiry and prevent an account deleted after a backup was taken from returning to active service after a restore. A production restore runbook should replay deletion tombstones or rerun the deletion register before reopening traffic.

## Deployment checklist

1. Apply migrations `0068_easy_ogun.sql` and `0069_careful_enchantress.sql` in order.
2. Configure `LEGAL_ARCHIVE_ENCRYPTION_KEY` with a base64url-encoded 32-byte key and set `LEGAL_ARCHIVE_FISCAL_YEAR_END` if Louez's financial year does not end on December 31.
3. Configure the private erasure credential for every enabled PostHog, Gleap, or OpenReplay SDK.
4. Verify `CRON_SECRET` and the unified `/api/cron` schedule so expired legal records are purged.
5. Exercise one empty test account and one account with a Louez billing record in a non-production environment.
6. Confirm processor API calls and the legal archive access controls in deployment logs without logging tokens or decrypted archive payloads.
7. Document the backup expiry and restore reconciliation procedure for the hosting environment.

## Legal references

- [French Code de commerce, article L123-22](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327)
- [Service-Public: accounting document retention periods](https://entreprendre.service-public.fr/vosdroits/F10029)
- [CNIL: the right to erasure](https://www.cnil.fr/fr/comprendre-mes-droits/le-droit-leffacement-supprimer-vos-donnees-en-ligne)

## Related

- [Security review](../code-review/06-security.md)
- [Data-layer review](../code-review/04-data-layer.md)
- [Backend conventions](../from-scratch/04-backend.md)
