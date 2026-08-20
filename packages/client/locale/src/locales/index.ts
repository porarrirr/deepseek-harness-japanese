/**
 * The common-namespace dictionaries. zh is the source of truth for the key
 * set (Chinese-first repo convention); en and ja are checked complete against
 * it — a missing or extra locale key is a compile error.
 */
export { zh } from './zh.ts'
export { en } from './en.ts'
export { ja } from './ja.ts'
export type { CommonKey } from './zh.ts'
