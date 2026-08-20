# トークンメーター

[English](token-meter.md) | [中文](token-meter.zh.md) | 日本語

`@deepseek-ai/dsh-token-meter`は、リクエスト負荷と位置付きサーフェス価格を表す、分離された1つのリプレイスナップショットを提供します。`logRevision`は計測の各フィールドで消費した永続イベント数です。

Source: [`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

## `TokenMeasurement`

```ts type-equiv
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}
```

`baseline.kind === 'usage'`は、直近に成功したプロバイダー呼び出しが同じ正規リクエストエンベロープを持ち、その合計がその呼び出しの完全なヒューリスティック基準値以上であることを示します。`estimated`は再利用可能な保守的usage基準値がないため、サービスが固定ヒューリスティックでエンベロープ全体とサーフェスを価格付けしたことを示します。後続の成功したリクエストは以前の基準値を置き換えます。符号付きの`surfaceDeltaTokens`は一致する基準値に対する増減を保持します。`totalTokens`はリクエストとレスポンスの負荷であり、`surfaceTokens`はサーフェスだけのヒューリスティック合計で、ノード価格の合計に等しくなります。

## `TokenSurfaceNode`

```ts type-equiv
/** One token-priced node in the current ordered session surface. */
interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}
```

サーフェスの順序が権威となります。置換ノードは、後続の位置ノードより大きい永続seqを持つことがあります。スナップショットは不変であり、基礎となるリプレイのfoldが進んでも拡大しません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtokenmeter--tokenmeter"></a>

### `ctx.tokenMeter` — `TokenMeter`

Replay owner for one service-wide estimator and isolated per-session folds.

```ts cordis-catalog
/**
 * Measure current request pressure and surface through the durable tail.
 *
 * Provider usage is reused only when the latest successful call's canonical
 * request envelope matches `requestHeader` and its total is no lower than
 * that call's full heuristic anchor; otherwise the complete envelope and
 * surface are heuristically repriced.
 *
 * `requestHeader` affects request pressure only; surface fields always
 * describe the current session surface. Every call clones those positional
 * nodes, so measurement is O(surface).
 *
 * @param session - session to replay through its current durable tail.
 * @param requestHeader - optional effective request envelope replacing the latest logged header.
 * @returns a detached deeply immutable pressure and surface measurement.
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed service heuristic.
 */
estimateMessage(message: Message): number
```

Types: [EpochHeader](session.md) · [Message](llm-streaming.md) · [Session](session.md)

Source: [`packages/llm/token-meter/src/index.ts:74`](../../packages/llm/token-meter/src/index.ts)
<!-- END GENERATED cordis-surface -->
