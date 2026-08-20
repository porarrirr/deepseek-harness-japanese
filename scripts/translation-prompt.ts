/**
 * Executable renderer and response parser for the committed
 * documentation-translation prompt contract (prompt-v4).
 *
 * The v4 contract: three placeholders (`source_lang`, `target_lang`,
 * `terminology`), whole-document translation, and a three-section response
 * (`<translation>`, `<review>`, `<final>` in order, bare XML tags with raw
 * Markdown bodies). The pipeline retains filename context outside the model
 * request and corrects the final language switcher after parsing.
 */

import { basename } from 'node:path'

/** Placeholder names supported by the committed translation prompt. */
export const TRANSLATION_PROMPT_PLACEHOLDERS = ['source_lang', 'target_lang', 'terminology'] as const

type TranslationPromptPlaceholder = (typeof TRANSLATION_PROMPT_PLACEHOLDERS)[number]

/** Languages accepted by the translation prompt. */
export type TranslationLanguage = 'English' | 'Chinese' | 'Japanese'

/** Inputs that vary for one rendered translation request. */
export interface TranslationPromptInput {
  sourceLanguage: TranslationLanguage
  /**
   * Target language. Omitting it preserves the existing English↔Chinese
   * default: English targets Chinese, and a translated source targets English.
   */
  targetLanguage?: TranslationLanguage
  /** Source basename, including `.md`, `.zh.md`, or `.ja.md`. */
  sourceFilename: string
  /** Complete current `terminology.md` contents. */
  terminology: string
}

/** One reviewed whole-document example with language-specific counterpart text. */
export interface TranslationExample {
  english: string
  chinese: string
  /**
   * Japanese calibration text. Existing bilingual examples may omit it, but
   * Japanese-direction requests reject an example without this content.
   */
  japanese?: string
}

/** Inputs for one complete model request. */
export interface TranslationRequestInput extends TranslationPromptInput {
  sourceDocument: string
  examples: TranslationExample[]
}

/** One model message in the provider-neutral translation request. */
interface TranslationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Fully assembled request plus the filename that receives the final body. */
export interface TranslationRequest {
  targetFilename: string
  messages: TranslationMessage[]
}

/** Parsed contents of the three-section response. */
export interface TranslationResponse {
  translation: string
  review: string
  final: string
}

const PLACEHOLDER = /{{([a-z_]+)}}/g
const TEMPLATE_OPEN = '## 模板正文\n\n````text\n'
const TEMPLATE_CLOSE = '\n````'
const RESPONSE_SECTIONS = ['translation', 'review', 'final'] as const
const RESPONSE_DELIMITERS = new Set(RESPONSE_SECTIONS.flatMap(section => [`<${section}>`, `</${section}>`]))
const LANGUAGE_SWITCHERS = [
  /^English \| \[中文\]\([^)\n]+\)(?: \| \[日本語\]\([^)\n]+\))?$/,
  /^\[English\]\([^)\n]+\) \| 中文(?: \| \[日本語\]\([^)\n]+\))?$/,
  /^\[English\]\([^)\n]+\) \| \[中文\]\([^)\n]+\) \| 日本語$/,
]

function assertNever(value: never): never {
  throw new Error(`translation prompt: unsupported language ${String(value)}`)
}

interface TranslationFiles {
  targetLanguage: TranslationLanguage
  targetFilename: string
  targetSwitcher: string
}

function sourceLanguageOfFilename(sourceFilename: string): TranslationLanguage {
  if (sourceFilename.endsWith('.zh.md')) return 'Chinese'
  if (sourceFilename.endsWith('.ja.md')) return 'Japanese'
  if (sourceFilename.endsWith('.md')) return 'English'
  throw new Error(`translation prompt: sourceFilename must end in .md, .zh.md, or .ja.md; got ${JSON.stringify(sourceFilename)}`)
}

function translationFiles(
  input: Pick<TranslationPromptInput, 'sourceFilename' | 'sourceLanguage' | 'targetLanguage'>,
): TranslationFiles {
  if (basename(input.sourceFilename) !== input.sourceFilename || input.sourceFilename.includes('\\')) {
    throw new Error(`translation prompt: sourceFilename must be a basename; got ${JSON.stringify(input.sourceFilename)}`)
  }
  const sourceLanguage = sourceLanguageOfFilename(input.sourceFilename)
  if (sourceLanguage !== input.sourceLanguage) {
    throw new Error(`translation prompt: ${input.sourceFilename} does not match source language ${input.sourceLanguage}`)
  }
  const targetLanguage = input.targetLanguage ?? (sourceLanguage === 'English' ? 'Chinese' : 'English')
  if (
    (sourceLanguage === 'English' && targetLanguage !== 'Chinese' && targetLanguage !== 'Japanese')
    || (sourceLanguage !== 'English' && targetLanguage !== 'English')
  ) {
    throw new Error(`translation prompt: unsupported translation direction ${sourceLanguage} to ${targetLanguage}`)
  }
  const englishFilename = sourceLanguage === 'Chinese'
    ? input.sourceFilename.replace(/\.zh\.md$/, '.md')
    : sourceLanguage === 'Japanese'
      ? input.sourceFilename.replace(/\.ja\.md$/, '.md')
      : input.sourceFilename
  const chineseFilename = englishFilename.replace(/\.md$/, '.zh.md')
  const japaneseFilename = englishFilename.replace(/\.md$/, '.ja.md')
  switch (targetLanguage) {
    case 'Chinese':
      return {
        targetLanguage,
        targetFilename: chineseFilename,
        targetSwitcher: `[English](${englishFilename}) | 中文`,
      }
    case 'Japanese':
      return {
        targetLanguage,
        targetFilename: japaneseFilename,
        targetSwitcher: `[English](${englishFilename}) | [中文](${chineseFilename}) | 日本語`,
      }
    case 'English':
      return {
        targetLanguage,
        targetFilename: englishFilename,
        targetSwitcher: sourceLanguage === 'Japanese'
          ? `English | [中文](${chineseFilename}) | [日本語](${japaneseFilename})`
          : `English | [中文](${chineseFilename})`,
      }
    default:
      return assertNever(targetLanguage)
  }
}

function exampleContent(example: TranslationExample, language: TranslationLanguage): string {
  switch (language) {
    case 'English':
      return example.english
    case 'Chinese':
      return example.chinese
    case 'Japanese':
      if (example.japanese === undefined) {
        throw new Error('translation request: Japanese-direction examples require Japanese content')
      }
      return example.japanese
    default:
      return assertNever(language)
  }
}

/** Extract the machine-consumed text fence from `translation-prompt.md`. */
function extractTranslationPrompt(document: string): string {
  const start = document.indexOf(TEMPLATE_OPEN)
  if (start === -1) throw new Error('translation prompt: missing `## 模板正文` text fence')
  const contentStart = start + TEMPLATE_OPEN.length
  const end = document.indexOf(TEMPLATE_CLOSE, contentStart)
  if (end === -1) throw new Error('translation prompt: missing closing four-backtick fence')
  return document.slice(contentStart, end)
}

/** Read the placeholder names documented in the prompt's contract table. */
export function documentedTranslationPromptPlaceholders(document: string): string[] {
  const preambleEnd = document.indexOf(TEMPLATE_OPEN)
  if (preambleEnd === -1) throw new Error('translation prompt: missing template body')
  return [...document.slice(0, preambleEnd).matchAll(/^\| `{{([a-z_]+)}}` \|/gm)].map(match => match[1] ?? '')
}

/** Render one system prompt from the checked-in template. */
export function renderTranslationPrompt(document: string, input: TranslationPromptInput): string {
  const files = translationFiles(input)
  const values: Record<TranslationPromptPlaceholder, string> = {
    source_lang: input.sourceLanguage,
    target_lang: files.targetLanguage,
    terminology: input.terminology,
  }
  const template = extractTranslationPrompt(document)
  const placeholderFreeTemplate = template.replace(PLACEHOLDER, '')
  if (placeholderFreeTemplate.includes('{{') || placeholderFreeTemplate.includes('}}')) {
    throw new Error('translation prompt: template contains malformed placeholder syntax')
  }
  const names = [...template.matchAll(PLACEHOLDER)].map(match => match[1] ?? '')
  const unknown = names.filter(name => !TRANSLATION_PROMPT_PLACEHOLDERS.includes(name as TranslationPromptPlaceholder))
  if (unknown.length > 0) throw new Error(`translation prompt: unsupported placeholder(s): ${[...new Set(unknown)].join(', ')}`)
  const missing = TRANSLATION_PROMPT_PLACEHOLDERS.filter(name => !names.includes(name))
  if (missing.length > 0) throw new Error(`translation prompt: template does not use required placeholder(s): ${missing.join(', ')}`)

  return template.replace(PLACEHOLDER, (_token, name: string) => values[name as TranslationPromptPlaceholder])
}

/**
 * Assemble the calibrated system prompt, reviewed bare-text examples, and source document.
 *
 * @param document - Checked-in translation prompt asset.
 * @param input - Direction, filename, terminology, examples, and source document.
 * @returns Provider-neutral messages and the target basename.
 */
export function renderTranslationRequest(document: string, input: TranslationRequestInput): TranslationRequest {
  const files = translationFiles(input)
  const messages: TranslationMessage[] = [{ role: 'system', content: renderTranslationPrompt(document, input) }]
  for (const example of input.examples) {
    messages.push(
      { role: 'user', content: exampleContent(example, input.sourceLanguage) },
      { role: 'assistant', content: exampleContent(example, files.targetLanguage) },
    )
  }
  messages.push({ role: 'user', content: input.sourceDocument })
  return { targetFilename: files.targetFilename, messages }
}

function escapeResponseBody(value: string): string {
  return value.split('\n').map((line) => {
    const delimiter = line.replace(/^\\+/, '')
    return RESPONSE_DELIMITERS.has(delimiter) ? `\\${line}` : line
  }).join('\n')
}

function unescapeResponseBody(value: string): string {
  return value.split('\n').map((line) => {
    if (!line.startsWith('\\')) return line
    const candidate = line.slice(1)
    return RESPONSE_DELIMITERS.has(candidate.replace(/^\\+/, '')) ? candidate : line
  }).join('\n')
}

/** Serialize a response in the exact escaped three-section format the prompt requests. */
export function renderTranslationResponse(response: TranslationResponse): string {
  return RESPONSE_SECTIONS.map(section => `<${section}>\n${escapeResponseBody(response[section])}\n</${section}>`).join('\n\n')
}

/**
 * Parse the three-section response. Sections must each appear exactly once
 * and in order; escaped delimiter lines in Markdown bodies are restored.
 * A fenced ```xml wrapper around the whole response is tolerated, matching
 * the wrapper some models copy from the prompt's own example.
 */
export function parseTranslationResponse(text: string): TranslationResponse {
  let body = text.trim()
  const fenced = /^```(?:xml)?\n([\s\S]*?)\n```$/.exec(body)
  if (fenced?.[1] !== undefined) body = fenced[1].trim()

  const values: Partial<Record<(typeof RESPONSE_SECTIONS)[number], string>> = {}
  const lines = body.split('\n')
  let previousCloseEnd = 0
  for (const [index, section] of RESPONSE_SECTIONS.entries()) {
    const open = `<${section}>`
    const close = `</${section}>`
    const openCount = lines.filter(line => line === open).length
    const closeCount = lines.filter(line => line === close).length
    if (openCount === 0 || closeCount === 0) {
      throw new Error(`translation response: missing or unterminated <${section}> section`)
    }
    if (openCount > 1 || closeCount > 1) throw new Error(`translation response: duplicate <${section}> section`)

    const openStart = body.search(new RegExp(`^<${section}>$`, 'm'))
    const closeStart = body.search(new RegExp(`^</${section}>$`, 'm'))
    const separator = body.slice(previousCloseEnd, openStart)
    if (closeStart < openStart || (index === 0 ? separator !== '' : !/^\n+$/.test(separator))) {
      throw new Error('translation response: sections must appear in translation, review, final order')
    }

    let contentStart = openStart + open.length
    if (body[contentStart] === '\n') contentStart++
    let contentEnd = closeStart
    if (body[contentEnd - 1] === '\n') contentEnd--
    values[section] = unescapeResponseBody(body.slice(contentStart, contentEnd))
    previousCloseEnd = closeStart + close.length
  }
  if (previousCloseEnd !== body.length) throw new Error('translation response: content is not allowed outside response sections')
  return values as TranslationResponse
}

function correctLanguageSwitcher(markdown: string, switcher: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  while (lines.at(-1) === '') lines.pop()

  let headingIndex = 0
  if (lines[0] === '---') {
    const frontmatterEnd = lines.indexOf('---', 1)
    if (frontmatterEnd === -1) throw new Error('translation response: final document has unterminated YAML frontmatter')
    headingIndex = frontmatterEnd + 1
    while (lines[headingIndex] === '') headingIndex++
  }
  if (!/^#\s+\S/.test(lines[headingIndex] ?? '')) {
    throw new Error('translation response: final document must start with an H1 heading')
  }

  let contentStart = headingIndex + 1
  while (lines[contentStart] === '') contentStart++
  if (LANGUAGE_SWITCHERS.some(pattern => pattern.test(lines[contentStart] ?? ''))) contentStart++
  while (lines[contentStart] === '') contentStart++

  const output = [...lines.slice(0, headingIndex), lines[headingIndex] as string, '', switcher]
  const content = lines.slice(contentStart)
  if (content.length > 0) output.push('', ...content)
  return `${output.join('\n')}\n`
}

/**
 * Parse a model response and make its consumed final document target-path correct.
 *
 * @param text - Raw three-section model response.
 * @param input - Source direction and basename retained by the pipeline.
 * @returns Parsed response whose `final` body has the canonical target switcher.
 */
export function consumeTranslationResponse(
  text: string,
  input: Pick<TranslationPromptInput, 'sourceFilename' | 'sourceLanguage' | 'targetLanguage'>,
): TranslationResponse {
  const parsed = parseTranslationResponse(text)
  const files = translationFiles(input)
  return { ...parsed, final: correctLanguageSwitcher(parsed.final, files.targetSwitcher) }
}
