import { APIError, getSessionFromCtx } from "better-auth/api";
import { z } from "zod";

type AccountDeletionRequestHook = (user: { userId: string }) => Promise<void>;
type AuthHookContext = Parameters<typeof getSessionFromCtx>[0];

const deletionConfirmationSchema = z.object({ token: z.string().min(1) });

// better-auth sends the confirmation e-mail through runInBackgroundOrAwait,
// which logs and swallows any error: whatever the e-mail sender throws, the
// client hears "Verification email sent". So a deletion request is refused
// here, from hooks.before, before the route answers. The link that confirms
// the deletion (a token in the body) is left to beforeDelete, which checks
// everything again when the account is actually deleted.
export const accountDeletionRequestBefore = async (
  ctx: AuthHookContext,
  {
    requestHook,
    emailConfigured,
  }: { requestHook: AccountDeletionRequestHook | null; emailConfigured: boolean },
): Promise<void> => {
  if (ctx.path !== "/delete-user") return;
  if (deletionConfirmationSchema.safeParse(ctx.body).success) return;

  const session = await getSessionFromCtx(ctx);
  if (!session) return;

  const unavailable = () =>
    new APIError("SERVICE_UNAVAILABLE", {
      message: "Account deletion is temporarily unavailable",
      code: "ACCOUNT_DELETION_UNAVAILABLE",
    });

  if (!requestHook) throw unavailable();
  try {
    await requestHook({ userId: session.user.id });
  } catch {
    throw unavailable();
  }
  if (!emailConfigured) {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: "Account deletion email is unavailable",
      code: "ACCOUNT_DELETION_EMAIL_UNAVAILABLE",
    });
  }
};
