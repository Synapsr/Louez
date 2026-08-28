import { clearActiveStore } from "@/lib/store-context";

// Intentionally public: Better Auth invalidates the session before the deleted
// user reaches this post-deletion cleanup. This endpoint only expires Louez's
// active-store cookie and does not read or mutate account or Store data.
export const POST = async () => {
  await clearActiveStore();
  return Response.json({ success: true });
};
