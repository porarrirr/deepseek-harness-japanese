# ランタイム不変条件

[English](invariants.md) | [中文](invariants.zh.md) | 日本語

[dsh-invariants](../../packages/runtime-diagnostics/invariants)は、パッケージ所有のランタイム不変条件チェックを行う設定可能なレジストリサービス（`ctx.invariants`）です。3パッケージのcapability seamではなく、supportグループの1パッケージであり、agent-loopのspineにも属しません。レジストリは選択、名前の予約、子fiberのライフサイクル、パッケージに帰属する失敗を所有し、各ワークスペースパッケージは正確なnpmパッケージ名でチェックを登録する`./invariant` companionプラグインを公開します。チェックがアサートできるもの（権威あるイベントストリームまたは可変データであり、サービスやメソッドの存在ではない）は[AGENTS.md](../../AGENTS.md#conventions)のランタイム不変条件規約で定めます。レジストリの設計は[invariant-service Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-owned-invariant-service.md)が所有します。

Source: [`packages/runtime-diagnostics/invariants/src/index.ts`](../../packages/runtime-diagnostics/invariants/src/index.ts)

## 選択

```ts type-equiv
/** Runtime invariant selection configured on the service plugin. */
interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

サービスが有効で、allowlistが空であるか少なくとも1つのパターンが完全なnpm名に一致し、blocklistのパターンが一致しない場合にパッケージが選択されます。blocklistの一致はallowlistの一致に優先します。エントリは`new RegExp(source)`でコンパイルされます。sourceに`^`と`$`がない限り一致はアンカーされず、`/pattern/flags`構文は解析されません。サービス起動時に検証が明確に失敗します。空白、前後に空白を含む、重複、不正なエントリはスキップせずthrowします。有効なパターンが現在読み込まれているパッケージに一致しなくてもよいため、後続の読み込みとHMRは決定的です。フィルターはサービスのライフタイム中固定されます（[README](../../packages/runtime-diagnostics/invariants/README.md)）。

## インストーラー

```ts type-equiv
/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
type InvariantFailure = (message: string) => never
```

```ts type-equiv
/** Install one package's checks into the registration's child context. */
interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}
```

有効なインストーラーは専用の子Cordis fiberで実行されます。`installer.inject`はそのfiberがアクセスできるサービスを宣言し、同期または非同期のインストーラー完了が結合されてから登録が成功します。`fail(message)`は`InvariantError`をthrowします。これは安定した`code: 'INVARIANT'`、所有する`packageName`、`invariant violated by "<package>": …`という接頭辞付きメッセージを持つ`extends Error`です。そのため、レジストリが製品パッケージをインポートせずに違反を特定できます。

## サービス

`ctx.invariants.register(packageName, installer)`は完全なnpmパッケージ名に対して1つのアクティブな登録を予約し、エフェクトスコープのdisposerを返します。フィルターによってインストーラーが非アクティブでも予約は保持されるため、2つのプラグインが同じパッケージ名を黙って要求することはありません。重複、空、空白を含む名前はthrowします。インストーラーが失敗すると子fiberをdisposeし、予約をアトミックに解放します。サービスはすべての登録fiberを所有し、返されたdisposerはcompanion fiberにも属します。どちらかをアンロードするとリスナー、トレース状態、予約が削除されるため、companionは状態を残さず同じ名前で再読み込みと登録を行えます。

## companionの約束

各ワークスペースパッケージは`./invariant` companion（[パッケージの約束](../../packages/AGENTS.md)）を所有します。公開と登録は網羅的ですが、アサーションは意図的に合成しません。パッケージが観測可能なイベントまたは可変データの関係を所有する場合だけcompanionはチェックをインストールし、それ以外では先頭コメントが`No runtime invariant:`で始まり、何もチェックできない理由をパッケージ固有に説明する空のインストーラーをエクスポートします。`pnpm run verify-package-invariants`は、生成マーカー、説明のない空インストーラー、reporterを省略または無視する空でないインストーラー、誤った登録名、不完全なエクスポート・公開・依存関係・bundle配線を機械的に拒否します（[mechanical-rule Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md)）。実行可能なcompanionのカタログと標準構成は[パッケージREADME](../../packages/runtime-diagnostics/invariants/README.md)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxinvariants--invariantregistry"></a>

### `ctx.invariants` — `InvariantRegistry`

Package-owned invariant registry with global and regex-based selection.

```ts cordis-catalog
/**
 * Register one package's invariant installer. The package name is reserved
 * even when filtering disables its checks. Enabled installers run in a child
 * fiber; failure disposes that fiber and releases the reservation.
 * @param packageName - full npm package name that owns the contribution.
 * @param installer - listener or startup-check installer for the child context.
 * @returns an effect-scoped disposer for the registration.
 */
register(packageName: string, installer: InvariantInstaller): () => void
```

Source: [`packages/runtime-diagnostics/invariants/src/index.ts:94`](../../packages/runtime-diagnostics/invariants/src/index.ts)
<!-- END GENERATED cordis-surface -->
