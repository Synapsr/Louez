import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ORPCError } from "@orpc/client";
import { createTranslator } from "next-intl";

import { handoffFailureMessage } from "@louez/api/contracts/handoffs";
import { INVITATION_EMAILS_PER_DAY, teamErrors } from "@louez/api/contracts/team";

import { teamErrorKey } from "./util.team-errors";

// An invitation refused past the daily cap says how many e-mails the store asked
// for, never that they were sent: an instance with no e-mail service sends none.

/** The error as the dashboard's client receives it. */
const received = (error: ReturnType<typeof teamErrors.emailLimit>) =>
  new ORPCError(error.code, { message: error.message, data: error.data });

const translate = (locale: string, key: string, values: Record<string, number>) =>
  createTranslator({
    locale,
    messages: JSON.parse(
      readFileSync(new URL(`../../../../messages/${locale}.json`, import.meta.url), "utf8"),
    ),
    namespace: "dashboard.team",
    onError: (error) => {
      throw error;
    },
  })(key as "invitationEmailLimit", values);

test("the daily cap of invitation e-mails reads as e-mails requested, in the dashboard and the API", () => {
  const error = teamErrors.emailLimit();
  const { scope, key, values } = teamErrorKey(received(error));
  assert.equal(scope, "team");
  assert.equal(key, "invitationEmailLimit");
  assert.deepEqual(values, { max: INVITATION_EMAILS_PER_DAY });

  const english = translate("en", key, values);
  assert.match(english, new RegExp(`requested ${INVITATION_EMAILS_PER_DAY} invitation e-mails`));
  assert.doesNotMatch(english, /(has|were|was) sent/);
  const french = translate("fr", key, values);
  assert.match(french, new RegExp(`demandé ${INVITATION_EMAILS_PER_DAY} e-mails d'invitation`));
  assert.doesNotMatch(french, /envoyé/);

  // What an agent reads: the API's message, and an approval that failed on the cap.
  assert.match(error.message, /requested \d+ invitation e-mails/);
  assert.doesNotMatch(error.message, /store sent/);
  assert.doesNotMatch(handoffFailureMessage("email_limit"), /store sent/);
});
