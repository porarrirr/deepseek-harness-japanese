/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
  'notice.imagesUnsupported': '/{command} 不接受图片附件，请先移除图片',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<CommandKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'search.placeholder': '検索…',
  'search.aria': '選択肢を絞り込む',
  'status.loading': '選択肢を読み込み中…',
  'status.applying': '適用中…',
  'status.empty': '選択肢なし',
  'overlay.aria': '/{command} の選択肢',
  'listbox.aria': '/{command} の一致項目',
  'notice.imagesUnsupported': '/{command} は画像添付に対応していません。先に画像を削除してください',
} satisfies Record<CommandKey, string>
