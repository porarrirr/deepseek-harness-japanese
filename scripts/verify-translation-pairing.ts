/**
 * Enforce the required language set, matching structure, and recorded git blob
 * hashes for every in-scope document. The manifest contains only explicit
 * exclusions, which may have neither a counterpart nor a sidecar.
 * `--list` reports state; `--write <pairs...>` records the named confirmed
 * pairs (`--write --all` records every complete pair); `--cached <pairs...>`
 * checks exact index bytes for hooks. A check or write named with pair paths
 * touches only those pairs, so update iteration does not pay for a corpus
 * scan. Translation quality remains a review responsibility.
 * See `docs/i18n/README.md` for the owning contract.
 */

import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { gitBlobHash, readGitIndexBlob, storeGitBlob } from './translation-pairing-git.ts'
import {
  parseTranslationPairingRecord,
  renderTranslationPairingRecord,
  translationPairPaths,
  type TranslationPairingMode,
} from './translation-pairing-record.ts'
import {
  hasLanguageSwitcher,
  isPublicTranslationSource,
  languageSwitcherTargets,
  languageSwitcherLine,
  parseTranslationMarkdown,
  parseTranslationPairingCliArgs,
  parseTranslationPairingManifest,
  partitionGeneratedRegions,
  requiresSourceLanguageSwitcher,
  isTranslationScopeFile,
  TRANSLATION_SCOPE_GLOB_EXCLUDES,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'

const root = resolve(import.meta.dirname, '..')
let request: ReturnType<typeof parseTranslationPairingCliArgs>
try {
  request = parseTranslationPairingCliArgs(process.argv.slice(2))
} catch (error) {
  console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const listMode = request.mode === 'list'
const writeMode = request.mode === 'write'
const indexMode = request.input === 'index'

const contentCache = new Map<string, Buffer | undefined>()

/** Read one repository path from the selected worktree or index plane. */
function readRepositoryFile(file: string): Buffer | undefined {
  if (contentCache.has(file)) return contentCache.get(file)
  const content = indexMode
    ? readGitIndexBlob(root, file)?.content
    : existsSync(join(root, file)) ? readFileSync(join(root, file)) : undefined
  contentCache.set(file, content)
  return content
}

/** Whether one path exists in the selected content plane. */
function repositoryFileExists(file: string): boolean {
  return readRepositoryFile(file) !== undefined
}

function requireJapaneseContent(source: string, content: Buffer | undefined): Buffer {
  if (content === undefined) throw new Error(`${source}: complete published pair has no Japanese content`)
  return content
}

/** Discover source Markdown and pairing sidecars before applying the corpus predicate. */
const SCOPE_PATTERNS = [
  '**/*.md',
  '**/*.i18n.yaml',
  '.agents/notes/**/*.md',
  '.agents/notes/**/*.i18n.yaml',
]

const manifestContent = readRepositoryFile('scripts/translation-pairing.manifest.json')
if (manifestContent === undefined) {
  throw new Error('scripts/translation-pairing.manifest.json is missing from the selected content plane')
}
const manifest = parseTranslationPairingManifest(manifestContent.toString('utf8'))

/**
 * An excluded entry ending in `/` excludes the whole directory. The trailing
 * slash IS the path boundary — `docs/tool-catalog/` cannot prefix-match a
 * sibling like `docs/tool-catalog-notes/x.md` — so directory entries in the
 * manifest must keep their trailing slash.
 */
function isExcluded(file: string): boolean {
  return manifest.excluded.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

// Enumerate the scope once: the whole corpus, or exactly the named pairs'
// four files (a named pair whose files are absent is caught by the same
// completeness rules that cover discovered remnants).
const files = new Set<string>()
if (request.scope === 'pairs') {
  for (const anchor of request.anchors) {
    const { source, zh, ja, meta } = translationPairPaths(anchor)
    for (const file of [source, zh, ja, meta]) {
      if (repositoryFileExists(file)) files.add(file)
    }
    // A named worktree anchor with no files still enters the source list so
    // an interactive check reports it. An index check accepts a complete
    // three-file deletion and still rejects every partial deletion below.
    if (!indexMode && !repositoryFileExists(anchor)) files.add(anchor)
  }
} else {
  for (const pattern of SCOPE_PATTERNS) {
    for (const match of globSync(pattern, { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join('/')
      if (isTranslationScopeFile(normalized)) files.add(normalized)
    }
  }
}
const translations = [...files].filter(f => f.endsWith('.zh.md')).sort()
const japaneseTranslations = [...files].filter(f => f.endsWith('.ja.md')).sort()
const metas = [...files].filter(f => f.endsWith('.i18n.yaml')).sort()
const sources = [...files]
  .filter(f => f.endsWith('.md') && !f.endsWith('.zh.md') && !f.endsWith('.ja.md'))
  .sort()

if (request.scope === 'pairs') {
  const rejected = request.anchors.filter(anchor => !isTranslationScopeFile(anchor) || isExcluded(anchor))
  const absent = request.anchors.filter((anchor) => {
    const { source, zh, ja, meta } = translationPairPaths(anchor)
    return ![source, zh, ja, meta].some(repositoryFileExists)
  })
  if (rejected.length > 0 || (!indexMode && absent.length > 0)) {
    for (const anchor of rejected) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`)
    }
    for (const anchor of absent) {
      console.error(`verify-translation-pairing: ${anchor} names no pair on disk (none of its four files exist)`)
    }
    process.exit(2)
  }
}

// --write: (re)record the required owner hashes for the requested complete pairs, creating
// missing records. A named pair that cannot be recorded (missing counterpart)
// fails loud; corpus scope (--all) skips pairless sources as before.
if (writeMode) {
  let written = 0
  for (const source of sources) {
    if (isExcluded(source)) continue
    const paths = translationPairPaths(source)
    const mode: TranslationPairingMode = isPublicTranslationSource(source) ? 'trilingual' : 'bilingual'
    const owners = mode === 'trilingual' ? [paths.source, paths.zh, paths.ja] : [paths.source, paths.zh]
    if (owners.some(file => !repositoryFileExists(file))) {
      if (request.scope === 'pairs') {
        const missing = owners.filter(file => !repositoryFileExists(file))
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${missing.join(', ')}`)
        process.exit(2)
      }
      continue
    }
    const sourceContent = readRepositoryFile(paths.source)
    const zhContent = readRepositoryFile(paths.zh)
    const jaContent = mode === 'trilingual' ? readRepositoryFile(paths.ja) : undefined
    if (
      sourceContent === undefined
      || zhContent === undefined
      || (mode === 'trilingual' && jaContent === undefined)
    ) {
      throw new Error(`${source}: complete pair became unreadable`)
    }
    // A consistency record is also a recovery pointer for the briefing
    // generator. Persist both snapshots even when the sidecar text is already
    // current, because the bytes may exist only in this working tree.
    const record = mode === 'trilingual'
      ? renderTranslationPairingRecord(paths, {
        sourceHash: storeGitBlob(root, sourceContent),
        zhHash: storeGitBlob(root, zhContent),
        jaHash: storeGitBlob(root, requireJapaneseContent(source, jaContent)),
      }, mode)
      : renderTranslationPairingRecord(paths, {
        sourceHash: storeGitBlob(root, sourceContent),
        zhHash: storeGitBlob(root, zhContent),
      }, mode)
    const { meta } = paths
    if (existsSync(join(root, meta)) && readFileSync(join(root, meta), 'utf8') === record) continue
    writeFileSync(join(root, meta), record)
    console.log(`verify-translation-pairing: recorded ${meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}

const errors: string[] = []
const state = new Map<string, 'ok' | 'out-of-sync' | 'missing'>()

function pairingMode(source: string): TranslationPairingMode {
  return isPublicTranslationSource(source) ? 'trilingual' : 'bilingual'
}

function ownerPaths(
  paths: ReturnType<typeof translationPairPaths>,
  mode: TranslationPairingMode,
): string[] {
  return mode === 'trilingual' ? [paths.source, paths.zh, paths.ja] : [paths.source, paths.zh]
}

// 1. Every discovered, non-excluded source has the language set required by
// its publication status.
for (const source of sources) {
  if (isExcluded(source)) continue
  const paths = translationPairPaths(source)
  const mode = pairingMode(source)
  const missing = ownerPaths(paths, mode).filter(file => !repositoryFileExists(file))
  if (missing.length > 0) {
    errors.push(`${source}: ${mode === 'trilingual' ? 'published' : 'non-public'} documentation has an incomplete pair — missing ${missing.join(', ')}; add the counterparts and record the pair`)
    state.set(source, 'missing')
  }
}

// 2. Every pair that exists at all is complete and consistent. Anchor on the
// union of translated files and .i18n.yaml records so a half-deleted pair is
// caught from any remnant.
const pairAnchors = new Set<string>()
for (const zh of translations) pairAnchors.add(zh.replace(/\.zh\.md$/, '.md'))
for (const ja of japaneseTranslations) pairAnchors.add(ja.replace(/\.ja\.md$/, '.md'))
for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, '.md'))

for (const source of [...pairAnchors].sort()) {
  const paths = translationPairPaths(source)
  const mode = pairingMode(source)
  const owners = ownerPaths(paths, mode)
  const { meta } = paths
  const missing = [...owners, meta].filter(file => !repositoryFileExists(file))

  if (isExcluded(source)) {
    for (const translation of [paths.zh, paths.ja]) {
      if (repositoryFileExists(translation)) {
        errors.push(`${translation}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`)
      }
    }
    if (repositoryFileExists(meta)) errors.push(`${meta}: ${source} is excluded from pairing; this consistency record must not exist`)
    continue
  }
  if (missing.length > 0) {
    errors.push(`${source}: incomplete ${mode} pair — missing ${missing.join(', ')} (pairs merge whole: all required languages plus the .i18n.yaml record)`)
    continue
  }
  if (mode === 'bilingual' && repositoryFileExists(paths.ja)) {
    errors.push(`${paths.ja}: non-public documentation uses the Japanese side; only published pages may carry a trilingual pair`)
    state.set(source, 'out-of-sync')
    continue
  }

  const contents = owners.map(file => readRepositoryFile(file))
  const metaContent = readRepositoryFile(meta)
  if (contents.some(content => content === undefined) || metaContent === undefined) {
    throw new Error(`${source}: complete pair became unreadable`)
  }
  const ownerContents = contents as Buffer[]
  const record = parseTranslationPairingRecord(metaContent.toString('utf8'), paths, mode)
  if (record === undefined) {
    const expected = ownerPaths(paths, mode).map(file => `\`${basename(file)}: <40-hex>\``).join(' and ')
    errors.push(`${meta}: malformed consistency record (expected exactly ${expected})`)
    continue
  }

  let consistent = true
  for (const [index, file] of owners.entries()) {
    const content = ownerContents[index]
    if (content === undefined) throw new Error(`${source}: complete pair became unreadable`)
    const current = gitBlobHash(content)
    const recorded = file === paths.source
      ? record.sourceHash
      : file === paths.zh
        ? record.zhHash
        : 'jaHash' in record ? record.jaHash : undefined
    if (recorded !== current) {
      errors.push(`${file}: out of sync — content no longer matches the pair's last confirmed-consistent state in ${meta} (bring the other side along, then re-record with --write)`)
      consistent = false
    }
  }
  if (!consistent) {
    state.set(source, 'out-of-sync')
    continue
  }

  // Generated regions are language-invariant: the exact same generator output
  // (markers included) must appear in every side, in the same order. The
  // structural signature below compares the region content again as part of
  // the whole document; this dedicated check names the divergence precisely
  // and rejects a region grammar violation on any side.
  let regions: { regions: string[]; stripped: string }[]
  try {
    regions = ownerContents.map(content => partitionGeneratedRegions(content.toString('utf8')))
  } catch (error) {
    errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`)
    state.set(source, 'out-of-sync')
    continue
  }
  const sourceRegions = regions[0]
  if (sourceRegions === undefined) throw new Error(`${source}: complete pair has no owner content`)
  let valid = true
  if (regions.some(candidate => candidate.regions.length !== sourceRegions.regions.length
    || candidate.regions.some((region, index) => region !== sourceRegions.regions[index]))) {
    errors.push(`${source}: generated regions differ between the pair — regenerate (the generator writes every side byte-identically)`)
    state.set(source, 'out-of-sync')
    valid = false
  }

  const trees = ownerContents.map(content => parseTranslationMarkdown(content.toString('utf8')))
  for (const [index, tree] of trees.entries()) {
    const file = owners[index]
    if (file === undefined) throw new Error(`${source}: complete pair has no owner path`)
    const language: 'en' | 'zh' | 'ja' = index === 0 ? 'en' : file === paths.zh ? 'zh' : 'ja'
    if (!(language === 'en' && !requiresSourceLanguageSwitcher(source))) {
      const counterpart = owners.find((_, targetIndex) => targetIndex !== index)
      if (counterpart === undefined) throw new Error(`${source}: complete pair has no counterpart path`)
      const expectedLine = languageSwitcherLine(language, source, mode)
      if (!hasLanguageSwitcher(tree, ownerContents[index]?.toString('utf8') ?? '', language, source, mode, counterpart)) {
        errors.push(`${file}: missing language switcher — expected exactly ${JSON.stringify(expectedLine)}`)
        valid = false
      }
    }
    const targets = owners
      .filter((_, targetIndex) => targetIndex !== index)
      .flatMap(target => languageSwitcherTargets(target))
    if (index === 0) {
      const sourceSignature = translationStructureSignature(tree, targets)
      for (let targetIndex = 1; targetIndex < trees.length; targetIndex++) {
        const targetTree = trees[targetIndex]
        if (targetTree === undefined) throw new Error(`${source}: complete pair has no parsed owner`)
        for (const divergence of translationStructureDiff(
          sourceSignature,
          translationStructureSignature(targetTree, owners
            .filter((_, candidateIndex) => candidateIndex !== targetIndex)
            .flatMap(target => languageSwitcherTargets(target))),
        )) {
          errors.push(`${source} ↔ ${owners[targetIndex]}: ${divergence}`)
          valid = false
        }
      }
    }
  }
  if (valid && !state.has(source)) state.set(source, 'ok')
  else if (!valid) state.set(source, 'out-of-sync')
}

// Complete the state map for --list: any in-scope, non-excluded document with no pair is missing.
for (const source of sources) {
  if (!isExcluded(source) && !state.has(source)) state.set(source, 'missing')
}

if (listMode) {
  const order = { 'out-of-sync': 0, missing: 1, ok: 2 } as const
  const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
  for (const [file, status] of rows) {
    console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
  }
  const counts = { 'ok': 0, 'out-of-sync': 0, 'missing': 0 }
  for (const status of state.values()) counts[status]++
  console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
  process.exit(0)
}

if (errors.length === 0) {
  console.log(request.scope === 'pairs'
    ? `verify-translation-pairing: ${pairAnchors.size} named ${indexMode ? 'staged ' : ''}pair(s) consistent; the corpus-wide check still runs in doc-sync.`
    : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`)
  process.exit(0)
}

console.error('verify-translation-pairing: translation pairing rules violated (see docs/i18n/README.md):')
for (const message of errors) console.error(`  ${message}`)
process.exit(1)
