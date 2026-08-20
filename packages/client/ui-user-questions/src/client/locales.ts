/** `question` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'error.incomplete': '请先完成这道问题。',
  'error.unanswered': '请选择一个选项或填写自定义答案。',
  'nav.prev': '上一题',
  'nav.next': '下一题',
  'nav.minimize': '收起问题卡片',
  'nav.maximize': '展开问题卡片',
  'nav.cancel': '放弃整组问题',
  'option.recommended': '推荐',
  'custom.placeholder': '输入你的答案',
  'action.skip': '跳过本题',
  'action.next': '下一题',
  'plan.header': '计划待审',
  'plan.approve': '确认执行',
  'plan.decline': '拒绝',
  'plan.discuss': '去聊天里说',
} satisfies Record<string, string>

/** The question namespace key union. */
export type QuestionKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'error.incomplete': 'Please complete this question first.',
  'error.unanswered': 'Please select an option or enter a custom answer.',
  'nav.prev': 'Previous question',
  'nav.next': 'Next question',
  'nav.minimize': 'Collapse the question card',
  'nav.maximize': 'Expand the question card',
  'nav.cancel': 'Dismiss all questions',
  'option.recommended': 'Recommended',
  'custom.placeholder': 'Type your answer',
  'action.skip': 'Skip this question',
  'action.next': 'Next',
  'plan.header': 'Plan review',
  'plan.approve': 'Approve',
  'plan.decline': 'Refuse',
  'plan.discuss': 'Chat about it',
} satisfies Record<QuestionKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  'error.incomplete': '先にこの質問を完了してください。',
  'error.unanswered': '選択肢を選ぶか、回答を入力してください。',
  'nav.prev': '前の質問',
  'nav.next': '次の質問',
  'nav.minimize': '質問カードを折りたたむ',
  'nav.maximize': '質問カードを展開',
  'nav.cancel': 'すべての質問を破棄',
  'option.recommended': 'おすすめ',
  'custom.placeholder': '回答を入力',
  'action.skip': 'この質問をスキップ',
  'action.next': '次へ',
  'plan.header': '計画の確認',
  'plan.approve': '承認',
  'plan.decline': '拒否',
  'plan.discuss': 'チャットで相談',
} satisfies Record<QuestionKey, string>
