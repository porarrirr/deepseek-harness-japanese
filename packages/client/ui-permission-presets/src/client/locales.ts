/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'title': '権限',
  'description': '新しいセッションのデフォルト権限モードを選択',
  'loading': '読み込み中',
  'unavailable': '利用できません',
  'confirm.title': 'Full access を有効にしますか？',
  'confirm.description': 'Full access を有効にすると、新しいセッションでは確認手順が減り、機密操作、ファイル変更、外部コマンドなど、より多くの操作を直接実行できます。後続のタスクを信頼できる場合にのみ使用してください。',
  'confirm.acknowledge': 'リスクを理解し、続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'Full access を有効にする',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'confirm.title': '确认启用 Full access？',
  'confirm.description': '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用 Full access',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>

/** Japanese dictionary for the current-session popup gate. */
export const accessJa = {
  'confirm.title': 'Full access を有効にしますか？',
  'confirm.description': 'Full access を有効にすると、エージェントは確認手順を減らし、機密操作、ファイル変更、外部コマンドなど、より多くの操作を直接実行できます。現在のタスクを信頼できる場合にのみ使用してください。',
  'confirm.acknowledge': 'リスクを理解し、続行します',
  'confirm.cancel': 'キャンセル',
  'confirm.enable': 'Full access を有効にする',
} satisfies Record<PermissionAccessKey, string>
