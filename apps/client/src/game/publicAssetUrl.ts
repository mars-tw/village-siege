/** Resolves a file copied from Vite's public directory against the configured deployment base. */
export function publicAssetUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const relativePath = path.replace(/^\/+/, "");
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${relativePath}`;
}
