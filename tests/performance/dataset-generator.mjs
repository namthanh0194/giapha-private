import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_SIZES = [100, 1_000, 5_000, 10_000]
const SUPPORTED_SET = new Set(SUPPORTED_SIZES)
const DEFAULT_SEED = 'gia-pha-performance-v1'
const DEFAULT_OUTPUT = resolve('tmp/performance/datasets')

function createRandom(seed) {
  let state = 0
  for (const character of seed)
    state = (state * 31 + character.codePointAt(0)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function deterministicUuid(seed, namespace, index) {
  const hex = createHash('sha256')
    .update(`${seed}:${namespace}:${index}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function shuffledIndexes(size, random) {
  const indexes = Array.from({ length: size }, (_, index) => index)
  for (let index = size - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[indexes[index], indexes[swap]] = [indexes[swap], indexes[index]]
  }
  return indexes
}

function generationSizes(personCount, generationCount) {
  const sizes = Array.from({ length: generationCount }, () => 1)
  let remaining = personCount - generationCount
  for (let index = 0; index < generationCount; index += 1) {
    const share =
      index === generationCount - 1
        ? remaining
        : Math.floor(remaining / (generationCount - index))
    sizes[index] += share
    remaining -= share
  }
  return sizes
}

function dateFor(index) {
  return `${2000 + (index % 25)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`
}

export function generateDataset({
  size,
  generations = Math.min(8, Math.max(1, Math.ceil(Math.log10(size)))),
  seed = DEFAULT_SEED
}) {
  if (!SUPPORTED_SET.has(size)) {
    throw new Error(`Supported sizes: ${SUPPORTED_SIZES.join(', ')}`)
  }
  if (!Number.isInteger(generations) || generations < 1 || generations > 8) {
    throw new Error('Generations must be an integer from 1 to 8.')
  }
  if (generations > size)
    throw new Error('Generations cannot exceed person count.')

  const random = createRandom(`${seed}:${size}:${generations}`)
  const privateIndexes = new Set(
    shuffledIndexes(size, random).slice(0, Math.round(size * 0.1))
  )
  const firstNames = [
    'An',
    'Bình',
    'Châu',
    'Dũng',
    'Giang',
    'Hà',
    'Hùng',
    'Lan',
    'Minh',
    'Ngọc'
  ]
  const lastNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng']
  const persons = []
  const peopleByGeneration = []
  let personIndex = 0

  for (const [generationIndex, count] of generationSizes(
    size,
    generations
  ).entries()) {
    const generation = []
    for (let birthOrder = 1; birthOrder <= count; birthOrder += 1) {
      const id = deterministicUuid(seed, 'person', personIndex)
      const isDeceased = generationIndex < generations - 2
      persons.push({
        id,
        full_name: `${lastNames[personIndex % lastNames.length]} ${firstNames[personIndex % firstNames.length]} ${generationIndex + 1}-${birthOrder}`,
        gender: personIndex % 2 === 0 ? 'male' : 'female',
        birth_year: 1920 + generationIndex * 25 + (birthOrder % 20),
        birth_month: (birthOrder % 12) + 1,
        birth_day: (birthOrder % 28) + 1,
        death_year: isDeceased ? 1990 + generationIndex * 15 : null,
        death_month: isDeceased ? (birthOrder % 12) + 1 : null,
        death_day: isDeceased ? (birthOrder % 28) + 1 : null,
        is_deceased: isDeceased,
        is_in_law: false,
        birth_order: birthOrder,
        generation: generationIndex + 1,
        privacy_level: privateIndexes.has(personIndex) ? 'private' : 'family'
      })
      generation.push(id)
      personIndex += 1
    }
    peopleByGeneration.push(generation)
  }

  const relationships = []
  const biological = []
  for (
    let generation = 1;
    generation < peopleByGeneration.length;
    generation += 1
  ) {
    const parents = peopleByGeneration[generation - 1]
    for (const childId of peopleByGeneration[generation]) {
      const parentCount = parents.length === 1 || random() < 0.35 ? 1 : 2
      for (const index of shuffledIndexes(parents.length, random).slice(
        0,
        parentCount
      )) {
        const relationship = {
          id: deterministicUuid(seed, 'biological', relationships.length),
          type: 'biological_child',
          person_a: parents[index],
          person_b: childId,
          note: null
        }
        relationships.push(relationship)
        biological.push(relationship)
      }
    }
  }

  const adoptionCount = Math.round(biological.length * 0.1)
  const personGenerations = new Map(
    persons.map((person) => [person.id, person.generation])
  )
  for (const index of shuffledIndexes(biological.length, random).slice(
    0,
    adoptionCount
  )) {
    const current = biological[index]
    const parentGeneration = personGenerations.get(current.person_a)
    const candidates = peopleByGeneration[parentGeneration - 1].filter(
      (personId) => personId !== current.person_a
    )
    relationships.push({
      id: deterministicUuid(seed, 'adopted', relationships.length),
      type: 'adopted_child',
      person_a:
        candidates.length > 0
          ? candidates[Math.floor(random() * candidates.length)]
          : current.person_a,
      person_b: current.person_b,
      note: 'Quan hệ nhận nuôi hư cấu phục vụ kiểm thử hiệu năng.'
    })
  }

  for (const generation of peopleByGeneration) {
    for (let index = 0; index + 1 < generation.length; index += 2) {
      if (random() < 0.35) {
        relationships.push({
          id: deterministicUuid(seed, 'marriage', relationships.length),
          type: 'marriage',
          person_a: generation[index],
          person_b: generation[index + 1],
          note: null
        })
      }
    }
  }

  const eventCount = Math.max(1, Math.round(size / 10))
  const galleryCount = Math.max(1, Math.round(size / 5))
  const custom_events = Array.from({ length: eventCount }, (_, index) => ({
    id: deterministicUuid(seed, 'event', index),
    name: `Sự kiện mô phỏng ${index + 1}`,
    content: 'Nội dung hư cấu phục vụ benchmark hiệu năng.',
    event_date: dateFor(index),
    location: `Nhà thờ họ chi ${(index % 8) + 1}`,
    person_id: persons[index % persons.length].id
  }))
  const gallery_items = Array.from({ length: galleryCount }, (_, index) => ({
    id: deterministicUuid(seed, 'gallery', index),
    title: `Ảnh tư liệu mô phỏng ${index + 1}`,
    description: 'Metadata hình ảnh hư cấu phục vụ kiểm thử benchmark.',
    image_url: `https://example.invalid/gallery/${index + 1}.jpg`,
    event_date: dateFor(index),
    person_id: persons[index % persons.length].id
  }))

  return {
    version: '5',
    generated_at: '2026-09-01T00:00:00.000Z',
    generator: {
      seed,
      size,
      generations,
      persons_count: persons.length,
      relationships_count: relationships.length,
      adopted_relationships_count: relationships.filter(
        (rel) => rel.type === 'adopted_child'
      ).length,
      private_persons_count: persons.filter(
        (person) => person.privacy_level === 'private'
      ).length
    },
    persons,
    relationships,
    person_details_private: [],
    custom_events,
    sources: [],
    person_citations: [],
    gallery_items
  }
}

export async function writeDataset(dataset, outputDirectory = DEFAULT_OUTPUT) {
  const targetPath = resolve(
    outputDirectory,
    `family-graph-${dataset.generator.size}.json`
  )
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
  return targetPath
}

export function validateDatasetStructure(dataset) {
  assert.ok(
    SUPPORTED_SET.has(dataset.persons.length),
    'Kích thước dataset phải nằm trong danh mục hỗ trợ.'
  )
  assert.equal(dataset.persons.length, dataset.generator.size)
  const privateCount = dataset.persons.filter(
    (person) => person.privacy_level === 'private'
  ).length
  assert.equal(privateCount, Math.round(dataset.persons.length * 0.1))
  const personGenerations = new Map(
    dataset.persons.map((person) => [person.id, person.generation])
  )
  for (const relationship of dataset.relationships) {
    if (
      relationship.type === 'biological_child' ||
      relationship.type === 'adopted_child'
    ) {
      const parentGen = personGenerations.get(relationship.person_a)
      const childGen = personGenerations.get(relationship.person_b)
      assert.ok(
        parentGen !== undefined &&
          childGen !== undefined &&
          parentGen < childGen,
        'Cây gia phả phải là đồ thị có hướng không chu trình.'
      )
    }
  }
  const adoptedCount = dataset.relationships.filter(
    (rel) => rel.type === 'adopted_child'
  ).length
  if (dataset.generator.generations > 1) {
    assert.ok(
      adoptedCount > 0,
      'Phải có quan hệ adopted_child mẫu khi có nhiều thế hệ.'
    )
  }
  assert.ok(
    dataset.custom_events.length > 0,
    'Phải có custom_events tỷ lệ theo người.'
  )
  assert.ok(
    dataset.gallery_items.length > 0,
    'Phải có gallery_items tỷ lệ theo người.'
  )
  return true
}

async function runCli() {
  const args = process.argv.slice(2)
  let size = 100
  let generations
  let seed = DEFAULT_SEED
  let output = DEFAULT_OUTPUT
  let generateAll = false
  let selfTest = false

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (key === '--size' && value) {
      size = Number(value)
      index += 1
    } else if (key === '--generations' && value) {
      generations = Number(value)
      index += 1
    } else if (key === '--seed' && value) {
      seed = value
      index += 1
    } else if (key === '--output' && value) {
      output = resolve(value)
      index += 1
    } else if (key === '--all') {
      generateAll = true
    } else if (key === '--self-test') {
      selfTest = true
    }
  }

  if (selfTest) {
    for (const testSize of SUPPORTED_SIZES) {
      const dataset = generateDataset({ size: testSize, seed })
      validateDatasetStructure(dataset)
    }
    process.stdout.write(
      `${JSON.stringify({ status: 'ok', selfTest: true, sizes: SUPPORTED_SIZES })}\n`
    )
    return
  }

  const sizes = generateAll ? SUPPORTED_SIZES : [size]
  const files = []
  for (const itemSize of sizes) {
    const dataset = generateDataset({ size: itemSize, generations, seed })
    validateDatasetStructure(dataset)
    files.push(await writeDataset(dataset, output))
  }
  process.stdout.write(`${JSON.stringify({ status: 'ok', files })}\n`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 1
  })
}
