import { handleUploadRequest } from "@louez/api/platform/uploads";

import { apiPorts } from "@/lib/api/ports";
import { withEvlog } from "@/lib/evlog";

interface RouteContext {
  params: Promise<{ token: string }>;
}

// Where an API caller sends an image when the storage takes no presigned
// upload. The signed token in the path is the credential: the categories
// image-upload procedure hands it out, bound to one key, type and size.
async function handleRequest(request: Request, context: RouteContext) {
  const { token } = await context.params;
  return handleUploadRequest(request, token, apiPorts);
}

export const PUT = withEvlog(handleRequest);
