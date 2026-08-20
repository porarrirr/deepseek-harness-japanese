# セッションローカルSchedule

[English](schedule.md) | [中文](schedule.zh.md) | 日本語

Scheduleは、元のlive Sessionに通常の後続会話turnとして戻る永続リマインダーを所有します。永続化とライフサイクルの判断は[durable Schedule Agent Note](../../.agents/notes/implemented/feature/2026-08-05-durable-web-schedule.md)、receiptを持たない境界は[conversational delivery](../../.agents/notes/implemented/simplification/2026-08-09-conversational-schedule-delivery.md)、ブラウザローカル解釈は[explicit time-zone boundary](../../.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md)、繰り返しは[bounded fixed-rate Schedule](../../.agents/notes/implemented/simplification/2026-08-09-bounded-fixed-rate-schedule.md)が管理します。このページには[`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts)の永続およびモデル向けの型を記録します。composition、ツール動作、正確なリマインダーのフレーミングは[パッケージREADME](../../packages/schedule/schedule/README.md)が管理します。

## 永続レコード

`ScheduleId`は[branded id](core.md#branded-ids)であり、1つのSession内で一意で再利用されません。Version 1は、正のsafe-integerである`after_seconds`遅延、明示的な絶対`at`ターゲット、または5分以上のsafe-integer`every_seconds`間隔をサポートします。作成時には最初のターゲットを4桁年のRFC 3339 UTC `scheduledAt`へ正規化します。`after`レコードは送信された遅延を保持し、`at`レコードは結果の時刻だけを保存し、`every`レコードは固定間隔と次のターゲットを保持します。

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot record variants that terminate on an id-only dispatch. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** The v1 durable reminder record union. */
type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord
```

## 絶対時刻入力

`at`セレクターは、厳密なoffset付きRFC 3339文字列、または正確なローカルカレンダーオブジェクトのいずれかです。ローカル形式では、ツール境界で解釈を明示します。

```ts type-equiv
/** Structured local-calendar input accepted by `schedule_create`. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by `schedule_create`. */
type AtInput = string | LocalAtInput
```

公式Web overlayは各promptについてブラウザのIANA zoneをサンプルします。Time-contextは、open turnに曖昧さのないブラウザzoneがある場合、他に修飾のない自然言語の日付と時刻をそのリクエストローカルzoneで解釈するようモデルに伝えます。provenanceが混在または欠落している場合はモデルに質問させます。この案内は永続Sessionのデフォルトではありません。モデルは文字列形式ではoffsetを、ローカル形式では`time_zone`を引き続き渡す必要があり、Scheduleはブラウザ、Session、プロセス、モデルのコンテキストを読みません。

Scheduleは不正なoffsetやzone、offsetのない文字列、未来でないターゲット、夏時間の欠落区間内のローカル時刻を拒否します。夏時間の重複では最初の早い時刻を選びます。成功した作成では正規UTCの`scheduledAt`だけを保存するため、リプレイが周囲のタイムゾーン状態に依存することはありません。

## 固定レート入力とキャッチアップ

`every_seconds`はレコードごとの300秒以上の間隔で、作成時刻を基準にします。固定レートの繰り返しだけを扱い、プロトコルにはカレンダーやCron式、繰り返しのタイムゾーン、共有cooldown、レコード間の受理ゲートはありません。

Sessionが停止中であったか、複数のターゲットにわたってビジーだった場合、1つのEveryレコードは直近の期限到来オカレンスだけを提供します。dispatchは、逃した間隔を列挙・永続化・リプレイせず、dispatch判断時刻の後にある作成基準に揃った最初のターゲットへ直接進めます。次のターゲットが4桁UTC年に収まらない場合、最後のdispatchでレコードを終了します。

複数の異なるEveryレコードが期限超過で、one-shotが期限到来していない場合、各レコードはターゲット順、作成順で同じfollow-up batchに1つのオカレンスを提供します。Everyレコードは独立した状態を保持し、そのbatchで受理されたすべてのdispatchは同じ判断時刻を使います。バッチ処理はモデルturn数を制限し、5分の最小値は各レコードのタイマー頻度を制限します。

## 永続変更とリプレイ

version-1の`schedule/change` SessionイベントだけがScheduleの永続的な権威です。Createは完全なレコードを保存し、deleteは終端のid-only遷移です。one-shot dispatchも終端でid-onlyです。Every dispatchは、直近の期限到来オカレンスを選ぶために使ったwall-clock判断時刻を持ち、通常はアクティブなレコードを終了せずに進めます。Dispatchはfollow-upが同期的にキューへ入ったことを意味し、モデルの回答が成功したことやユーザーが読んだことは意味しません。

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

strict decoderとfoldは、未知のversion、余分なフィールド、再利用されたid、one-shotまたはEvery dispatchの不一致な型、非アクティブなレコードへのdeleteまたはdispatch遷移を拒否します。通常のSessionは完全なイベントストリームをfoldします。forkは`SessionHeader.seedLength`以降のイベントだけをfoldするため、履歴は保持しつつ親Sessionのアクティブなリマインダーは採用しません。`schedule/change`の宣言とソース位置は[persistence catalog](../persistence-catalog.md#schedulechange--log-only)にもインデックスされます。

## アクティブビューと管理

ツール値は永続レコードと現在のwall clockから導出した配信状態を組み合わせます。`session-local`は元のSessionがliveでなければならないことを意味します。外部通知チャネルやcold-session schedulerはありません。

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Fixed v1 delivery boundary: the original session must be live. */
type ScheduleDeliveryMode = 'session-local'
```

```ts type-equiv
/** Complete model-facing view of one active reminder. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

生成された[tool catalog](../tool-catalog.md#deepseek-aidsh-schedule)が、`schedule_create`、`schedule_list`、`schedule_delete`の引数と結果のスキーマを管理します。管理呼び出しは、期限到来作業と1つのAgentスコープキューで直列化されます。すべての読み取りや判断は最初に共有Session永続化バリアを待ち、createと実際のdeleteはappend後にも再度待ちます。バリアが失敗した場合、先行書き込みがコミットされたか推測せず`persistence_uncertain`を報告します。その他の安定したエラーコードは`invalid_prompt`、`invalid_selector`、`invalid_rule`、`invalid_time_zone`、`not_future`、`time_out_of_range`、`frequency_too_high`、`corrupt_schedule_log`、`internal_error`です。

## Live配信

プロセスローカルのownerは永続foldから最も早いタイマーを導出し、範囲を限定した待機のたびにwall clockを読み直します。Cold Sessionは何もせず、再開するとタイマーを再構築し、過去のターゲットを期限超過にします。期限到来したone-shotを優先し、一度に1つの後続turnに入れます。one-shotが期限到来していない場合は、期限超過したすべてのEveryレコードが前述の1つのbatchになります。

期限到来作業はAgentが完全にidleになるまで待ち、maintenance phaseをclaimしてから状態を再foldし、判断をサンプルし、1つの`followup()`をキューに入れ、対応するdispatch変更をappendします。`steer()`を呼ばず、現在のturnを中断することもありません。

受理されたone-shotまたは固定レートのbatchは通常の後続turnを1つ開始し、通常の会話transcriptにのみ現れます。Scheduleには独立した永続Web receiptやブラウザrendererはありません。フレーミングまたは同期キュー受理に失敗した場合、dispatchは記録されずリマインダーはアクティブなままです。受理後、永続dispatch前の狭いクラッシュ区間では復旧後にリマインダー内容が繰り返される可能性があるため、この境界はexactly-onceではなくbest-effort at-least-once配信です。
