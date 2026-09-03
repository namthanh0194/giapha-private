export function buildContentSecurityPolicy(isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'", "'unsafe-inline'"]

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'script-src': scriptSrc,
    // ponytail: inline styles allowed until a nonce/style refactor
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
    'connect-src': ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']
  }

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ')
}
