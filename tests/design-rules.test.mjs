import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
let describeFn, itFn, expectFn
if (process.env.VITEST) {
  const vitest = await import('vitest')
  describeFn = vitest.describe
  itFn = vitest.it
  expectFn = vitest.expect
} else {
  const nodeTest = await import('node:test')
  const nodeAssert = await import('node:assert/strict')
  describeFn = nodeTest.describe || ((name, fn) => fn())
  itFn = nodeTest.test || nodeTest.default
  expectFn = (actual) => ({
    toMatch: (reg) => nodeAssert.match(actual, reg),
    not: { toBe: (expected) => nodeAssert.notEqual(actual, expected) },
    toEqual: (expected) => nodeAssert.deepEqual(actual, expected)
  })
}

const uiFiles = [
  'app/dashboard/activity/page.tsx',
  'app/dashboard/duplicates/page.tsx',
  'app/dashboard/lineage/page.tsx',
  'app/dashboard/reviews/page.tsx',
  'app/setup/page.tsx',
  'components/ActivityHistory.tsx',
  'components/ChangeRequestList.tsx',
  'components/DuplicateReview.tsx',
  'components/GalleryGrid.tsx',
  'components/HeaderMenu.tsx',
  'components/MemberForm.tsx',
  'components/PersonCard.tsx',
  'components/SourcesManager.tsx',
  'components/modal/CustomEventModal.tsx',
  'components/modal/DialogShell.tsx',
  'components/modal/MemberDetailModal.tsx',
  'components/modal/SourceModal.tsx',
  'components/modal/UploadModal.tsx',
  'context/MemberDetailContent.tsx'
]

const documentedAllowlist = new Map([
  // Add entries as ['path:rule', 'reason'] only when the exception is explicit in DESIGN.md.
])

const designHexColors = new Set([
  '#1c1917',
  '#57534e',
  '#d97706',
  '#fafaf9',
  '#ffffff',
  '#e7e5e4',
  '#dc2626',
  '#292524'
])

function classValues(source) {
  return [...source.matchAll(/className=(?:\{)?(?:'([^']*)'|"([^"]*)"|`([^`]*)`)(?:\})?/g)].map(
    (match) => match[1] ?? match[2] ?? match[3]
  )
}

function violationsFor(file) {
  const source = readFileSync(resolve(file), 'utf8')
  const violations = []
  const add = (rule, detail) => {
    if (!documentedAllowlist.has(`${file}:${rule}`)) {
      violations.push(`${file}: ${detail}`)
    }
  }

  if (/\bfont-bold\b/.test(source)) add('font-bold', 'uses font-bold')
  if (/\btracking-[\w[\]-]+/.test(source)) add('tracking', 'uses tracking-*')
  if (/\buppercase\b/.test(source)) add('uppercase', 'uses uppercase')
  if (/[\p{Extended_Pictographic}]/u.test(source)) add('emoji', 'uses an emoji')

  for (const color of source.match(/#[\da-f]{3,8}(?![\da-f])/gi) ?? []) {
    if (!designHexColors.has(color.toLowerCase())) {
      add('hex-color', `uses undocumented hex color ${color}`)
    }
  }

  for (const classes of classValues(source)) {
    const utilities = classes
      .trim()
      .split(/\s+/)
      .map((utility) => utility.split(':').at(-1))
    if (
      utilities.some((utility) => /^border(?:-|$)/.test(utility)) &&
      utilities.some((utility) => /^shadow(?:-|$)/.test(utility))
    ) {
      add('border-shadow', `combines border and shadow utilities: ${classes}`)
    }
  }

  const bodyOrControl = /<(?:p|span|label|button|input|textarea|select|option|a|li)\b[^>]*className=(?:\{)?(?:'([^']*)'|"([^"]*)"|`([^`]*)`)(?:\})?/g
  for (const match of source.matchAll(bodyOrControl)) {
    const classes = match[1] ?? match[2] ?? match[3] ?? ''
    if (/\btext-(?:base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(classes)) {
      add('body-control-text-size', `uses body/control text-base or larger: ${classes}`)
    }
  }

  return violations
}

describeFn('DESIGN.md static rules', () => {
  itFn('documents every allowlist exception with a reason', () => {
    for (const [key, reason] of documentedAllowlist) {
      expectFn(key).toMatch(/^[^:]+:[a-z-]+$/)
      expectFn(reason.trim()).not.toBe('')
    }
  })

  itFn('keeps touched UI files within the design system', () => {
    expectFn(uiFiles.flatMap(violationsFor)).toEqual([])
  })
})
