import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContentSecurityPolicy } from '../utils/security-headers.ts'

test('buildContentSecurityPolicy satisfies mandatory directives', () => {
  const prodCsp = buildContentSecurityPolicy(false)
  const devCsp = buildContentSecurityPolicy(true)

  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co"
  ]) assert.ok(prodCsp.includes(directive))

  assert.ok(!prodCsp.includes("'unsafe-eval'"))
  assert.ok(devCsp.includes("'unsafe-eval'"))
})

test('buildContentSecurityPolicy renders valid Report-Only payload for both modes', () => {
  const prod = buildContentSecurityPolicy(false)
  const dev = buildContentSecurityPolicy(true)
  assert.ok(prod.startsWith("default-src 'self'"))
  assert.ok(dev.startsWith("default-src 'self'"))
  assert.ok(prod.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co"))
  assert.ok(dev.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co"))
})
