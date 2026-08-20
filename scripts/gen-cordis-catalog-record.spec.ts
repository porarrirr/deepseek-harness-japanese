/**
 * Negative-path coverage for the guarded pair auto-record
 * (`maybeRecordPair`): the safety property is that regeneration re-records a
 * pair's `.i18n.yaml` ONLY for a region-confined write over a well-formed,
 * previously-consistent record — every other state is left for the pairing
 * gate to report.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { maybeRecordPair, REGION_BEGIN, REGION_END, spliceRegion } from './gen-cordis-catalog.ts'
import { blobHash, renderPairMeta } from './translation-pairing.ts'

const PAGE = 'docs/subsystems/fix.md'
const ZH = 'docs/subsystems/fix.zh.md'
const META = 'docs/subsystems/fix.i18n.yaml'
const PUBLIC_PAGE = 'docs/user/guide/providers.md'
const PUBLIC_ZH = 'docs/user/guide/providers.zh.md'
const PUBLIC_JA = 'docs/user/guide/providers.ja.md'
const PUBLIC_META = 'docs/user/guide/providers.i18n.yaml'

function page(prose: string, region: string): string {
  return `# Fix\n\n${prose}\n\n${REGION_BEGIN}\n${region}\n${REGION_END}\n`
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Lay out a pair on disk and return { root, before } for a regeneration that already wrote `current`. */
function setup(options: {
  beforeEn: string
  beforeZh: string
  currentEn: string
  currentZh: string
  meta?: string | null
  omitZhSnapshot?: boolean
}): { root: string; before: Map<string, Buffer> } {
  const root = mkdtempSync(join(tmpdir(), 'record-guard-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/subsystems'), { recursive: true })
  writeFileSync(join(root, PAGE), options.currentEn)
  writeFileSync(join(root, ZH), options.currentZh)
  const meta = options.meta === undefined
    ? renderPairMeta(PAGE, blobHash(Buffer.from(options.beforeEn)), ZH, blobHash(Buffer.from(options.beforeZh)))
    : options.meta
  if (meta !== null) writeFileSync(join(root, META), meta)
  const before = new Map<string, Buffer>([[PAGE, Buffer.from(options.beforeEn)]])
  if (!options.omitZhSnapshot) before.set(ZH, Buffer.from(options.beforeZh))
  return { root, before }
}

/** Lay out a public three-language pair for the region re-record guard. */
function setupPublic(options: {
  beforeEn: string
  beforeZh: string
  beforeJa: string
  currentEn: string
  currentZh: string
  currentJa: string
  meta?: string | null
}): { root: string; before: Map<string, Buffer> } {
  const root = mkdtempSync(join(tmpdir(), 'record-guard-public-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/user/guide'), { recursive: true })
  writeFileSync(join(root, PUBLIC_PAGE), options.currentEn)
  writeFileSync(join(root, PUBLIC_ZH), options.currentZh)
  writeFileSync(join(root, PUBLIC_JA), options.currentJa)
  const meta = options.meta === undefined
    ? renderPairMeta(
      PUBLIC_PAGE,
      blobHash(Buffer.from(options.beforeEn)),
      PUBLIC_ZH,
      blobHash(Buffer.from(options.beforeZh)),
      PUBLIC_JA,
      blobHash(Buffer.from(options.beforeJa)),
    )
    : options.meta
  if (meta !== null) writeFileSync(join(root, PUBLIC_META), meta)
  const before = new Map<string, Buffer>([
    [PUBLIC_PAGE, Buffer.from(options.beforeEn)],
    [PUBLIC_ZH, Buffer.from(options.beforeZh)],
    [PUBLIC_JA, Buffer.from(options.beforeJa)],
  ])
  return { root, before }
}

describe('maybeRecordPair', () => {
  const beforeEn = page('prose.', 'old region')
  const beforeZh = page('散文。', 'old region')
  const currentEn = page('prose.', 'new region')
  const currentZh = page('散文。', 'new region')

  it('re-records a region-confined write over a consistent record', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh })
    expect(maybeRecordPair(PAGE, before, root)).toBe(true)
    expect(readFileSync(join(root, META), 'utf8'))
      .toBe(renderPairMeta(PAGE, blobHash(Buffer.from(currentEn)), ZH, blobHash(Buffer.from(currentZh))))
  })

  it('re-records all three owner hashes for a public region write', () => {
    const beforeJa = page('プローズ。', 'old region')
    const currentJa = page('プローズ。', 'new region')
    const { root, before } = setupPublic({
      beforeEn,
      beforeZh,
      beforeJa,
      currentEn,
      currentZh,
      currentJa,
    })
    expect(maybeRecordPair(PUBLIC_PAGE, before, root)).toBe(true)
    expect(readFileSync(join(root, PUBLIC_META), 'utf8'))
      .toBe(renderPairMeta(
        PUBLIC_PAGE,
        blobHash(Buffer.from(currentEn)),
        PUBLIC_ZH,
        blobHash(Buffer.from(currentZh)),
        PUBLIC_JA,
        blobHash(Buffer.from(currentJa)),
      ))
  })

  it('refuses when the pair was already out of sync before the run', () => {
    const stale = renderPairMeta(PAGE, blobHash(Buffer.from('drifted long ago\n')), ZH, blobHash(Buffer.from(beforeZh)))
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: stale })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(stale)
  })

  it('refuses a malformed record even when its hashes are current', () => {
    // A renamed key with preserved hashes must stay the pairing gate's error,
    // never become valid through regeneration.
    const renamedKeys = [
      '# comment',
      `fixXmd: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.zh.md: ${blobHash(Buffer.from(beforeZh))}`,
      '',
    ].join('\n')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: renamedKeys })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(renamedKeys)
  })

  it('refuses a record with extra entries', () => {
    const extra = renderPairMeta(PAGE, blobHash(Buffer.from(beforeEn)), ZH, blobHash(Buffer.from(beforeZh)))
      + `other.md: ${blobHash(Buffer.from(beforeEn))}\n`
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: extra })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses a record with a duplicated expected key', () => {
    // Map#set would collapse the duplicate back to size 2; the parser must
    // reject the repeat instead of letting the guard accept the record.
    const duplicated = [
      `fix.md: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.md: ${blobHash(Buffer.from(beforeEn))}`,
      `fix.zh.md: ${blobHash(Buffer.from(beforeZh))}`,
      '',
    ].join('\n')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: duplicated })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
    expect(readFileSync(join(root, META), 'utf8')).toBe(duplicated)
  })

  it('refuses when prose drifted alongside the region write', () => {
    const proseDrift = page('prose, edited by a human.', 'new region')
    const { root, before } = setup({ beforeEn, beforeZh, currentEn: proseDrift, currentZh })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses a brand-new pair with no record', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, meta: null })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })

  it('refuses when a side has no pre-write snapshot', () => {
    const { root, before } = setup({ beforeEn, beforeZh, currentEn, currentZh, omitZhSnapshot: true })
    expect(maybeRecordPair(PAGE, before, root)).toBe(false)
  })
})

describe('spliceRegion', () => {
  it('replaces exactly the cordis-surface region', () => {
    const doc = `# T\n\nprose\n\n${REGION_BEGIN}\nold\n${REGION_END}\ntail\n`
    expect(spliceRegion(doc, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toBe(`# T\n\nprose\n\n${REGION_BEGIN}\nnew\n${REGION_END}\ntail\n`)
  })

  it('fails loud on a page carrying only some other generator\'s region', () => {
    // Another generator's markers satisfy the generic region grammar but must
    // never be overwritten by THIS generator's splice.
    const foreign = '# T\n\n<!-- BEGIN GENERATED other-surface (other-gen.ts) — do not edit between markers -->\ntheirs\n<!-- END GENERATED other-surface -->\n'
    expect(() => spliceRegion(foreign, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('expected exactly 1 cordis-surface region, found 0 BEGIN/0 END')
  })

  it('fails loud on duplicate cordis-surface markers', () => {
    const doubled = `${REGION_BEGIN}\na\n${REGION_END}\n${REGION_BEGIN}\nb\n${REGION_END}\n`
    expect(() => spliceRegion(doubled, `${REGION_BEGIN}\nnew\n${REGION_END}`))
      .toThrow('found 2 BEGIN/2 END')
  })
})
