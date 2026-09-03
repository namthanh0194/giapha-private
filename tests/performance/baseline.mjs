import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const DEFAULT_BASE_URL = `http://127.0.0.1:${process.env.PORT ?? '3000'}`
const DEFAULT_RUNS = 5
const DEFAULT_OUTPUT = resolve('tmp/performance')

const PROBES = [
  {
    name: 'dashboard',
    path: '/dashboard',
    requiresSession: true,
    plans: {
      persons:
        'SELECT id, full_name, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased FROM public.persons',
      events:
        'SELECT id, name, content, event_date, location, created_by FROM public.custom_events'
    }
  },
  {
    name: 'member-list',
    path: '/dashboard/members?view=list&page=1',
    requiresSession: true,
    plans: {
      list: 'SELECT id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, is_deceased, is_in_law, birth_order, generation, avatar_url, privacy_level FROM public.persons ORDER BY generation ASC NULLS LAST, birth_order ASC NULLS LAST, birth_year ASC NULLS LAST, id ASC LIMIT 50'
    }
  },
  {
    name: 'member-search',
    path: '/dashboard/members?view=list&page=1&query=Nguyen',
    requiresSession: true,
    plans: {
      search:
        "SELECT id, full_name, gender, birth_year, birth_month, birth_day, death_year, death_month, death_day, is_deceased, is_in_law, birth_order, generation, avatar_url, privacy_level FROM public.persons WHERE full_name ILIKE '%Nguyen%' ORDER BY generation ASC NULLS LAST, birth_order ASC NULLS LAST, birth_year ASC NULLS LAST, id ASC LIMIT 50"
    }
  },
  {
    name: 'kinship',
    path: '/dashboard/kinship',
    requiresSession: true,
    plans: {
      persons:
        'SELECT id, full_name, gender, birth_year, birth_order, generation, is_in_law, avatar_url FROM public.persons ORDER BY birth_year ASC NULLS LAST, id ASC',
      relationships:
        'SELECT id, type, person_a, person_b, note FROM public.relationships ORDER BY id ASC'
    }
  },
  {
    name: 'tree-root',
    path: '/dashboard/members?view=tree',
    requiresSession: true,
    plans: { topology: 'SELECT public.get_family_tree_topology()' }
  },
  {
    name: 'gallery-first-page',
    path: '/dashboard/gallery',
    requiresSession: true,
    plans: {
      gallery:
        'SELECT id, title, description, image_url, event_date, created_at, person_id FROM public.gallery_items ORDER BY created_at DESC LIMIT 50'
    }
  },
  {
    name: 'activity-first-page',
    path: '/dashboard/activity',
    requiresSession: true,
    plans: {
      activity:
        'SELECT id, actor_id, action, entity_type, entity_id, created_at FROM public.audit_log ORDER BY created_at DESC LIMIT 50'
    }
  }
]

export function percentile95(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  ]
}

function parseArgs(args) {
  const options = {
    baseUrl: process.env.PERFORMANCE_BASE_URL ?? DEFAULT_BASE_URL,
    runs: Number(process.env.PERFORMANCE_RUNS ?? DEFAULT_RUNS),
    output: DEFAULT_OUTPUT,
    cookie: process.env.PERFORMANCE_COOKIE,
    selfTest: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (key === '--base-url' && value) {
      options.baseUrl = value
      index += 1
    } else if (key === '--runs' && value) {
      options.runs = Number(value)
      index += 1
    } else if (key === '--output' && value) {
      options.output = resolve(value)
      index += 1
    } else if (key === '--self-test') {
      options.selfTest = true
    } else {
      throw new Error(`Unknown or incomplete option: ${key}`)
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new Error('Runs must be a positive integer.')
  }
  return options
}

async function benchmarkProbe(probe, options) {
  if (probe.requiresSession && !options.cookie) {
    return {
      name: probe.name,
      path: probe.path,
      status: 'skipped',
      reason: 'PERFORMANCE_COOKIE is required for this authenticated probe.',
      samples: []
    }
  }

  const samples = []
  const url = new URL(probe.path, options.baseUrl).toString()
  for (let run = 1; run <= options.runs; run += 1) {
    const startedAt = performance.now()
    try {
      const response = await fetch(url, {
        headers: options.cookie ? { cookie: options.cookie } : undefined,
        redirect: 'manual',
        cache: 'no-store'
      })
      if (response.status < 200 || response.status > 299) {
        return {
          name: probe.name,
          path: probe.path,
          status: 'skipped',
          reason: `Expected an authenticated 2xx response, received HTTP ${response.status}.`,
          samples: []
        }
      }
      const body = new Uint8Array(await response.arrayBuffer())
      samples.push({
        run,
        status: response.status,
        bytes: body.byteLength,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2))
      })
    } catch (error) {
      return {
        name: probe.name,
        path: probe.path,
        status: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
        samples: []
      }
    }
  }

  const elapsedMs = samples.map((sample) => sample.elapsedMs)
  const bytes = samples.map((sample) => sample.bytes)
  return {
    name: probe.name,
    path: probe.path,
    status: [...new Set(samples.map((sample) => sample.status))],
    bytes: {
      min: Math.min(...bytes),
      max: Math.max(...bytes),
      p95: percentile95(bytes)
    },
    elapsedMs: {
      min: Math.min(...elapsedMs),
      max: Math.max(...elapsedMs),
      p95: percentile95(elapsedMs)
    },
    samples
  }
}

async function captureQueryPlan(query, dbUrl) {
  const command = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query};`
  const { stdout } = await execFileAsync('psql', [
    '-X',
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '--dbname',
    dbUrl,
    '-c',
    command
  ])
  return JSON.parse(stdout.trim())
}

async function getDatabaseUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  try {
    const environment = await readFile(resolve('.env.local'), 'utf8')
    const match = environment.match(
      /^SUPABASE_DB_URL\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n#]*))\s*$/m
    )
    return match ? (match[1] ?? match[2] ?? match[3]).trim() : undefined
  } catch {
    return undefined
  }
}

async function runBaseline(options) {
  const report = {
    measured_at: new Date().toISOString(),
    base_url: options.baseUrl,
    runs_per_probe: options.runs,
    probes: [],
    query_plans: {},
    note: 'Read-only HTTP benchmark results. Plans captured only when SUPABASE_DB_URL is available.'
  }

  for (const probe of PROBES) {
    report.probes.push(await benchmarkProbe(probe, options))
  }
  report.status = report.probes.some((probe) => probe.status === 'unavailable')
    ? 'unavailable'
    : report.probes.every((probe) => Array.isArray(probe.status))
      ? 'ok'
      : 'skipped'

  const dbUrl =
    process.env.PERFORMANCE_SKIP_QUERY_PLANS === '1'
      ? undefined
      : await getDatabaseUrl()
  if (dbUrl) {
    for (const probe of PROBES) {
      report.query_plans[probe.name] = {}
      for (const [key, query] of Object.entries(probe.plans ?? {})) {
        try {
          report.query_plans[probe.name][key] = await captureQueryPlan(
            query,
            dbUrl
          )
        } catch (error) {
          report.query_plans[probe.name][key] = {
            status: 'skipped',
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
  } else {
    report.query_plan_status =
      process.env.PERFORMANCE_SKIP_QUERY_PLANS === '1'
        ? 'skipped by PERFORMANCE_SKIP_QUERY_PLANS'
        : 'skipped because SUPABASE_DB_URL is not configured'
  }

  await mkdir(options.output, { recursive: true })
  const targetPath = resolve(options.output, 'baseline-report.json')
  await writeFile(targetPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { targetPath, report }
}

async function selfTest() {
  assert.equal(percentile95([10, 20, 30, 40, 50]), 50)
  assert.equal(percentile95([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]), 100)
  assert.equal(percentile95([]), 0)

  const unauthProbe = { name: 'protected', path: '/protected', requiresSession: true }
  const skippedProbe = await benchmarkProbe(unauthProbe, { baseUrl: 'http://127.0.0.1:1', runs: 1 })
  assert.equal(skippedProbe.status, 'skipped')
  assert.equal(skippedProbe.samples.length, 0)

  const unavailableProbe = await benchmarkProbe(unauthProbe, { baseUrl: 'http://127.0.0.1:1', cookie: 's=1', runs: 1 })
  assert.equal(unavailableProbe.status, 'unavailable')
  assert.equal(unavailableProbe.samples.length, 0)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) {
    await selfTest()
    process.stdout.write(
      `${JSON.stringify({ status: 'ok', selfTest: true, probesCount: PROBES.length })}\n`
    )
    return
  }
  const { targetPath, report } = await runBaseline(options)
  process.stdout.write(
    `${JSON.stringify({ status: report.status, targetPath, probes: report.probes.map((item) => ({ name: item.name, status: item.status, p95Ms: item.elapsedMs?.p95 ?? null })) })}\n`
  )
  if (report.status !== 'ok') process.exitCode = 2
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
  })
}
