import { apiJson as json } from "@/lib/api-service-response";
import { verifyCatalogRequest } from "@/lib/catalog-auth";

export async function handleCatalogCohortGet(params: {
  request: Request;
  secret: string | undefined;
  getCohortStatus: () => Promise<{ taken: number; total: number; remaining: number }>;
}) {
  if (
    !(await verifyCatalogRequest({
      request: params.request,
      secret: params.secret,
    }))
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  return json(await params.getCohortStatus());
}
