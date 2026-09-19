export function isTrustedMutationOrigin(method: string, url: string, origin: string | undefined, appOrigin: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !url.startsWith('/v1/')) {
    return true;
  }
  return origin === appOrigin;
}
