---
type: improved
---

## Your assistant reads what you decided, and why

When your AI assistant asks to invite someone to your team, the approval page now has a field where you can add a few words for the assistant (500 characters at most) before you approve or refuse. The assistant reads your answer in `handoffs_get` (`GET /handoffs/{id}`) as `decision`: approved or refused, when, and your words if you added any. If you approve but the invitation can no longer go out, for example because your team has no seat left, the assistant reads that you approved and why it could not be done, instead of a refusal. Your words are kept as plain text.
