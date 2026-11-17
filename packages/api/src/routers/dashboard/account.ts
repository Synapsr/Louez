import { getProfileInput, getProfileOutput } from "../../contracts/account";
import { dismissNoticeInput, dismissNoticeOutput } from "../../contracts/dismissed-notices";
import { accountProcedure } from "../../platform/procedures";
import { getAccountProfile } from "../../services/account-profile";
import { dismissNotice as closeNotice } from "../../services/dismissed-notices";

/**
 * Who the connection acts for. ChatGPT reads it as the account's profile to
 * tell the user's accounts apart; every connection may call it.
 */
const getProfile = accountProcedure
  .meta({
    capability: "account.getProfile",
    account: true,
    mcp: {
      name: "account_get_profile",
      title: "Get Account Profile",
      description:
        "The Louez account this connection acts for: its stable id and the user's name. Takes no argument.",
      bundle: "daily",
      annotations: { idempotentHint: true },
      profile: true,
    },
  })
  .route({
    method: "GET",
    path: "/account/profile",
    description:
      "Returns the Louez account the API key acts for, its owner's: its `id`, stable and never reused, and its `name`, left out when the account has none. Takes no parameter.",
  })
  .input(getProfileInput)
  .output(getProfileOutput)
  .handler(({ context }) => getAccountProfile(context.actor.credential.userId));

/**
 * The signed-in user's own interface preferences: they belong to the account,
 * not to a store, and only the user's dashboard session sets them.
 */
const preferences = accountProcedure.meta({
  account: true,
  actors: ["session"],
  mcp: { exclude: "interface preferences of the dashboard user, no business effect" },
});

/** Closes an informational notice of the dashboard for good, on every device. */
const dismissNotice = preferences
  .meta({ capability: "ui.dismissNotice" })
  .input(dismissNoticeInput)
  .output(dismissNoticeOutput)
  .handler(async ({ context, input }) => ({
    dismissedNoticeIds: await closeNotice({
      userId: context.actor.credential.userId,
      noticeId: input.noticeId,
    }),
  }));

export const dashboardAccountRouter = {
  getProfile,
  dismissNotice,
};
