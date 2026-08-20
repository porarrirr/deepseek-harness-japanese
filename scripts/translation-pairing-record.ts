/** Canonical paths, parsing, and rendering for translation pairing records. */

import { basename } from 'node:path'

/** The repository-relative paths that can form one translation pair. */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Simplified Chinese document path. */
  zh: string
  /** Japanese document path used by published pages. */
  ja: string
  /** Generated consistency-record path. */
  meta: string
}

/** The language sets supported by the pairing record format. */
export type TranslationPairingMode = 'bilingual' | 'trilingual'

/** The two content hashes recorded for a non-public pair. */
export interface BilingualTranslationPairingRecord {
  /** Git blob hash of the English document. */
  sourceHash: string
  /** Git blob hash of the Simplified Chinese document. */
  zhHash: string
}

/** The three content hashes recorded for a published pair. */
export interface TrilingualTranslationPairingRecord extends BilingualTranslationPairingRecord {
  /** Git blob hash of the Japanese document. */
  jaHash: string
}

/** A consistency record for either a non-public or published document. */
export type TranslationPairingRecord =
  | BilingualTranslationPairingRecord
  | TrilingualTranslationPairingRecord

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Derive the counterpart and consistency-record paths from an English document.
 *
 * @param source - Repository-relative English Markdown path.
 * @returns The complete three-path pair.
 */
export function translationPairPaths(source: string): TranslationPairPaths {
  if (!source.endsWith('.md') || source.endsWith('.zh.md') || source.endsWith('.ja.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  return {
    source,
    zh: source.replace(/\.md$/, '.zh.md'),
    ja: source.replace(/\.md$/, '.ja.md'),
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Derive one pair from its consistency-record path.
 *
 * @param meta - Repository-relative `foo.i18n.yaml` path.
 * @returns The complete three-path pair.
 */
export function translationPairPathsFromMeta(meta: string): TranslationPairPaths {
  if (!meta.endsWith('.i18n.yaml')) {
    throw new Error(`expected a bilingual consistency-record path, received ${JSON.stringify(meta)}`)
  }
  return translationPairPaths(meta.replace(/\.i18n\.yaml$/, '.md'))
}

/**
 * Parse a consistency record for its expected sibling names.
 *
 * @param content - Complete sidecar text.
 * @param paths - Expected sibling paths.
 * @param mode - Required language set for the record.
 * @returns The recorded hashes, or `undefined` for malformed, duplicate, or unexpected keys.
 */
export function parseTranslationPairingRecord(
  content: string,
  paths: TranslationPairPaths,
  mode: TranslationPairingMode = 'bilingual',
): TranslationPairingRecord | undefined {
  const hashes = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  const sourceHash = hashes.get(basename(paths.source))
  const zhHash = hashes.get(basename(paths.zh))
  const jaHash = hashes.get(basename(paths.ja))
  const expectedSize = mode === 'trilingual' ? 3 : 2
  if (hashes.size !== expectedSize || sourceHash === undefined || zhHash === undefined) {
    return undefined
  }
  if (mode === 'trilingual') {
    if (jaHash === undefined) return undefined
    return { sourceHash, zhHash, jaHash }
  }
  return { sourceHash, zhHash }
}

/**
 * Render the canonical consistency record for a pair.
 *
 * @param paths - Pair paths written into the record and its recovery command.
 * @param record - Confirmed content hashes.
 * @param mode - Optional language set; when omitted it is inferred from `record`.
 * @returns Canonical YAML text with exactly one trailing newline.
 */
export function renderTranslationPairingRecord(
  paths: TranslationPairPaths,
  record: TranslationPairingRecord,
  mode?: TranslationPairingMode,
): string {
  const inferredMode: TranslationPairingMode = 'jaHash' in record ? 'trilingual' : 'bilingual'
  const expectedMode = mode ?? inferredMode
  if (expectedMode !== inferredMode) {
    throw new Error(`translation pairing record mode ${expectedMode} does not match its hashes`)
  }
  const entries = [
    `${basename(paths.source)}: ${record.sourceHash}`,
    `${basename(paths.zh)}: ${record.zhHash}`,
    ...(expectedMode === 'trilingual'
      ? 'jaHash' in record
        ? [`${basename(paths.ja)}: ${record.jaHash}`]
        : (() => { throw new Error('trilingual translation pairing record is missing its Japanese hash') })()
      : []),
  ]
  return [
    '# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. Both languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    ...entries,
    '',
  ].join('\n')
}
