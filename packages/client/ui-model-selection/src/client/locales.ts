/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本会话使用的模型',
  'option.loadError': '目录加载失败：{message}',
  'trigger.fallback': '选择模型',
  'trigger.selectAria': '选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.aria': '模型与推理等级',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': 'Default',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.reload': '重新加载',
  'warning.groupLoad': '{name} 加载失败：{message}',
  'empty.models': '没有可用的模型。',
  'blocked.composer': '当前模型不可用，请先选择模型',
  'empty.efforts': '当前模型未提供推理等级。',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'command.description': 'この会話で使用するモデルを選択',
  'option.loadError': 'カタログの読み込みに失敗しました：{message}',
  'trigger.fallback': 'モデルを選択',
  'trigger.selectAria': 'モデルを選択',
  'trigger.aria': 'モデルを選択、現在は {model}',
  'trigger.ariaEffort': 'モデルを選択、現在は {model}、推論レベル {effort}',
  'menu.aria': 'モデルと推論レベル',
  'menu.model': 'モデル',
  'menu.effort': '推論レベル',
  'effort.providerDefault': 'デフォルト',
  'status.loading': 'モデル一覧を更新中…',
  'error.action': 'モデルの操作に失敗しました：{message}',
  'action.reload': '再読み込み',
  'warning.groupLoad': '{name} の読み込みに失敗しました：{message}',
  'empty.models': '利用できるモデルがありません。',
  'blocked.composer': '現在のモデルは利用できません。先にモデルを選択してください',
  'empty.efforts': '現在のモデルには推論レベルがありません。',
} satisfies Record<ModelKey, string>
