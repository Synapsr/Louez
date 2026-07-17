export const createPublicFilesRequest = (
  request: Request,
  allowedOrigins: readonly string[],
  fallbackOrigin: string,
): Request => {
  const requestOrigin = request.headers.get("origin");
  const publicOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : fallbackOrigin;
  const requestUrl = new URL(request.url);
  const publicUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, publicOrigin);

  return new Request(publicUrl, request);
};
