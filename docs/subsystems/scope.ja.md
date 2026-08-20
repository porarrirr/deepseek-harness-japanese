# スコープ付き登録

[English](scope.md) | [中文](scope.zh.md) | 日本語

[scopeパッケージ](../../packages/core/scope)は、1つの登録コンテキストがagentごとの可視性と共有ライフタイム所有の両方を表せるようにする、識別情報、キャリア、スコープ付きレイヤーの語彙を提供します。Cordisサービスではなくライブラリプリミティブです。ライフサイクルの理由は[agent-scope runtime-design Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#scope-routing-one-opaque-key-selects-one-layer)、レジストリレイヤーの判断は[shared-storage Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)、呼び出し可能なAPIとフィルタリングのセマンティクスはパッケージの[README](../../packages/core/scope/README.md)が管理します。

Sources: [`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts) and [`packages/core/scope/src/store.ts`](../../packages/core/scope/src/store.ts).

## 識別情報とディスパッチキャリア

`ScopeKey`は不透明なオブジェクト識別情報です。提供済みのループは実行中の`Agent`オブジェクト自体をキーにしますが、プリミティブはオブジェクトを調べません。

```ts type-equiv
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`Scoped<T>`は`scopeTarget(base, key)`が返す不透明なルーティング受信側に付くコンパイル時ブランドです。スコープでフィルタされたイベント宣言はこのキャリアを`this`型として要求しますが、実際のイベント対象は明示的な引数のままです。

```ts type-equiv
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

## 所有される登録コンテキスト

`Scope`はタグ付き登録コンテキストと2つの解体経路を組み合わせます。`rawDispose`は順序付き複合エフェクトに必要な正確なCordis disposerの識別情報を保持し、`dispose()`は直接呼び出し側と競合する呼び出し側が共有する公開の完全停止境界です。

```ts type-equiv
/** A minted registration scope and its quiescent disposal boundaries. */
interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}
```

## スコープ付きレジストリレイヤー

`ScopeLayer`は、グローバルまたは正確なスコープレベルにおける1つのレジストリの完全な貢献を表します。具体的なレイヤーは複数の名前付き／匿名テーブルを集約できます。レイヤー全体が空であることにより、`ScopedLayers`は兄弟テーブルを破棄せずスコープ状態を回収できます。

```ts type-equiv
/** One scope's aggregate contribution to a registry. */
interface ScopeLayer {
  /** Whether every table in this layer is empty. */
  isEmpty(): boolean
}
```

`ScopedLayers<L>`は即時作成されるグローバルレイヤーと、遅延作成される正確なスコープレイヤーを所有します。読み取りでレイヤーは作成されません。`peek(undefined)`はオーバーレイなしを意味し、`merge()`は挿入順のグローバルな名前付きエントリに続けてスコープのシャドーを具体化します。登録は可視性とCordisエフェクト所有の両方に1つのコンテキストを使い、任意通知の前に同期的な取り消しを1つ収集し、Cordisの正確なdisposerを返します。完全な`ScopeLayer`が空になったときだけスコープレイヤーを回収します。

`NamedEntries<V>`は挿入順の検索とライブ反復を提供し、重複エラーは呼び出し側が所有します。`AnonymousEntries<V>`は各appendに一意の識別情報を与え、同じ値も独立して扱います。反復は1つの空でないテーブル世代の中でライブのままです。テーブルをdrainすると、既存の反復子は後続の挿入から切り離されます。両方ともべき等な正確なエントリ取り消しを返します。共有`EntryValues`実装インターフェースは公開されません。
