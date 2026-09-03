#!/usr/bin/env node
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PORT ?? '3000'}`
const DEFAULT_DURATION_MS = 30_000
const DEFAULT_CONCURRENCY = 1
const DEFAULT_OUTPUT = resolve('tmp/performance')
export const PROFILE_CONCURRENCIES = [1, 5, 20, 50]

export const DEFAULT_ENDPOINT_PATHS = {
  list: '/dashboard/members?view=list&page=1',
  search: '/api/search/persons?q=Ng&limit=20',
  subtree: '/dashboard/members?view=tree',
  detail: process.env.LOAD_PERSON_ID
    ? `/dashboard/members/${encodeURIComponent(process.env.LOAD_PERSON_ID)}`
    : '/dashboard/members',
  event: '/dashboard/events',
  gallery: '/dashboard/gallery',
  activity: '/dashboard/activity'
}

export const DEFAULT_MEMBER_FORBIDDEN = [
  'private-person',
  'private audit',
  'admin-only',
  '"audit":',
  '"admin":'
]

export function percentile(values, percentileValue) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return Number(
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)].toFixed(2)
  )
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return parsed
}

export function parseRoleCookies(rawValue) {
  if (!rawValue) return {}
  try {
    const parsed = JSON.parse(rawValue)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('must be a JSON object')
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry) => typeof entry[1] === 'string' && entry[1].trim())
    )
  } catch (error) {
    throw new Error(`LOAD_ROLE_COOKIES ${error instanceof Error ? error.message : 'is invalid'}.`)
  }
}

export function parseArgs(args) {
  const options = {
    baseUrl: process.env.LOAD_BASE_URL ?? process.env.PERFORMANCE_BASE_URL ?? DEFAULT_BASE_URL,
    concurrency: parsePositiveInteger(process.env.LOAD_CONCURRENCY ?? DEFAULT_CONCURRENCY, 'Concurrency'),
    durationMs: parsePositiveInteger(process.env.LOAD_DURATION_MS ?? DEFAULT_DURATION_MS, 'Duration'),
    cookies: process.env.LOAD_COOKIES ?? process.env.PERFORMANCE_COOKIE ?? '',
    roleCookies: parseRoleCookies(process.env.LOAD_ROLE_COOKIES),
    endpointPaths: { ...DEFAULT_ENDPOINT_PATHS },
    output: DEFAULT_OUTPUT,
    profiles: false,
    selfTest: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (key === '--base-url' && value) {
      options.baseUrl = value
      index += 1
    } else if (key === '--concurrency' && value) {
      options.concurrency = parsePositiveInteger(value, 'Concurrency')
      index += 1
    } else if (key === '--duration-ms' && value) {
      options.durationMs = parsePositiveInteger(value, 'Duration')
      index += 1
    } else if (key === '--cookie' && value) {
      options.cookies = options.cookies ? `${options.cookies}; ${value}` : value
      index += 1
    } else if (key === '--role-cookie' && value) {
      const separator = value.indexOf('=')
      if (separator < 1 || !value.slice(separator + 1).trim()) {
        throw new Error('--role-cookie must be role=cookie-value.')
      }
      options.roleCookies[value.slice(0, separator)] = value.slice(separator + 1)
      index += 1
    } else if (key === '--output' && value) {
      options.output = resolve(value)
      index += 1
    } else if (key === '--profiles') {
      options.profiles = true
    } else if (key === '--self-test') {
      options.selfTest = true
    } else {
      throw new Error(`Unknown or incomplete option: ${key}`)
    }
  }

  new URL(options.baseUrl)
  return options
}

export function summarize(samples) {
  const elapsedMs = samples.map((sample) => sample.elapsedMs)
  const errors = samples.filter((sample) => sample.error || sample.status >= 400)
  const responseBytes = samples.reduce((total, sample) => total + sample.bytes, 0)
  return {
    requests: samples.length,
    p50Ms: percentile(elapsedMs, 0.5),
    p95Ms: percentile(elapsedMs, 0.95),
    errorRate: samples.length === 0 ? 1 : Number((errors.length / samples.length).toFixed(4)),
    responseBytes
  }
}

async function runWorker({ baseUrl, cookie, deadline, endpointEntries, samples, privacyAssertions, violations }) {
  let requestIndex = 0
  while (performance.now() < deadline) {
    const [name, path] = endpointEntries[requestIndex % endpointEntries.length]
    requestIndex += 1
    const startedAt = performance.now()
    let status = 0
    let bytes = 0
    let body = ''
    let error
    try {
      const response = await fetch(new URL(path, baseUrl), {
        headers: cookie ? { cookie } : undefined,
        redirect: 'manual',
        cache: 'no-store'
      })
      status = response.status
      const payload = new Uint8Array(await response.arrayBuffer())
      bytes = payload.byteLength
      body = new TextDecoder().decode(payload)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
    const sample = {
      endpoint: name,
      status,
      bytes,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      ...(error ? { error } : {})
    }
    samples.push(sample)
    for (const forbidden of privacyAssertions) {
      if (body.toLowerCase().includes(forbidden.toLowerCase())) {
        violations.push({ endpoint: name, forbidden, status })
      }
    }
  }
}

export async function runLoadTest({
  baseUrl = DEFAULT_BASE_URL,
  concurrency = DEFAULT_CONCURRENCY,
  durationMs = DEFAULT_DURATION_MS,
  cookies = '',
  roleCookies = {},
  endpointPaths = DEFAULT_ENDPOINT_PATHS,
  output = DEFAULT_OUTPUT,
  privacyAssertions = {}
} = {}) {
  parsePositiveInteger(concurrency, 'Concurrency')
  parsePositiveInteger(durationMs, 'Duration')
  const endpointEntries = Object.entries(endpointPaths)
  if (endpointEntries.length === 0) throw new Error('At least one endpoint is required.')

  const roles = Object.entries(roleCookies)
  const sessions = roles.length > 0 ? roles : [['default', cookies]]
  const samplesByRole = Object.fromEntries(sessions.map(([role]) => [role, []]))
  const privacyViolations = []
  const deadline = performance.now() + durationMs
  const workers = Array.from({ length: concurrency }, (_, index) => {
    const [role, cookie] = sessions[index % sessions.length]
    return runWorker({
      baseUrl,
      cookie,
      deadline,
      endpointEntries,
      samples: samplesByRole[role],
      privacyAssertions: privacyAssertions[role] ?? [],
      violations: privacyViolations
    })
  })
  await Promise.all(workers)

  const allSamples = Object.values(samplesByRole).flat()
  const endpointReports = Object.fromEntries(
    endpointEntries.map(([name]) => [name, summarize(allSamples.filter((sample) => sample.endpoint === name))])
  )
  const report = {
    status: privacyViolations.length === 0 ? 'pass' : 'fail',
    generatedAt: new Date().toISOString(),
    mode: 'measurement',
    baseUrl,
    concurrency,
    durationMs,
    sessions: Object.fromEntries(sessions.map(([role, cookie]) => [role, cookie ? 'configured' : 'none'])),
    endpoints: endpointReports,
    roles: Object.fromEntries(Object.entries(samplesByRole).map(([role, samples]) => [role, summarize(samples)])),
    privacy: { violations: privacyViolations }
  }

  await mkdir(output, { recursive: true })
  const filename = `load-report-c${concurrency}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const file = resolve(output, filename)
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`)
  return { ...report, file }
}

export async function startSelfTestServer() {
  const server = http.createServer((request, response) => {
    const role = request.headers.cookie?.match(/role=([^;]+)/)?.[1] ?? 'anonymous'
    const body = JSON.stringify(
      role === 'member'
        ? { endpoint: new URL(request.url, 'http://localhost').pathname, person: { id: 'safe-person', name: 'Public person' } }
        : { endpoint: new URL(request.url, 'http://localhost').pathname, audit: { role: 'admin' }, person: { id: 'safe-person', name: 'Public person' } }
    )
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    response.end(body)
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

export async function runSelfTest() {
  const { server, baseUrl } = await startSelfTestServer()
  const profileReports = []
  try {
    for (const concurrency of PROFILE_CONCURRENCIES) {
      const result = await runLoadTest({
        baseUrl,
        concurrency,
        durationMs: 60,
        endpointPaths: Object.fromEntries(Object.keys(DEFAULT_ENDPOINT_PATHS).map((name) => [name, `/${name}`])),
        roleCookies: { member: 'role=member', admin: 'role=admin' },
        privacyAssertions: { member: DEFAULT_MEMBER_FORBIDDEN }
      })
      assert.equal(result.status, 'pass')
      assert.ok(result.endpoints.list.requests > 0)
      assert.equal(result.endpoints.list.errorRate, 0)
      assert.equal(result.privacy.violations.length, 0)
      profileReports.push({ concurrency, file: result.file, requests: result.endpoints.list.requests })
    }
    return { status: 'pass', selfTest: true, profiles: profileReports }
  } finally {
    await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())))
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) {
    const result = await runSelfTest()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  const profiles = options.profiles ? PROFILE_CONCURRENCIES : [options.concurrency]
  const reports = []
  for (const concurrency of profiles) {
    reports.push(await runLoadTest({
      ...options,
      concurrency,
      privacyAssertions: Object.fromEntries(
        Object.keys(options.roleCookies).map((role) => [role, role === 'member' ? DEFAULT_MEMBER_FORBIDDEN : []])
      )
    }))
  }
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
  })
}
