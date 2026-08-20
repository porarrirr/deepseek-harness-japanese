# ユーザーcredential

[English](credentials.md) | [中文](credentials.zh.md) | 日本語

[dsh-credentials](../../packages/credentials/credentials)のcredential seamは、秘密情報を設定から分離します。settings sectionと`cordis.yml` entryは*参照*（環境変数名）を運び、[dsh-credentials-local](../../packages/credentials/credentials-local)などのプロバイダーが値を所有し、consumerは操作ごとに1回参照を解決します。LLMアダプターはモデルリクエストごとに1回解決するため、credentialをローテーションすると再起動なしで次のリクエストに反映されます。すべてのプロバイダーには、保存された空値はどこでも未設定として扱うというseam全体のルールがあります。

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## 識別情報

参照は、POSIX形式の環境変数名で1つのcredentialを指定します。brandにより、呼び出し側がcredential参照をパッケージ間またはプロセス間で渡す別の文字列と混同することを防ぎ、構築時にshell identifier構文を検証します。

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 解決

`resolve(ref)`は値と、それを提供したプロバイダー定義のソースレイヤーを返します。未設定の場合は`undefined`です。consumerは操作ごとに再解決し、操作をまたいでキャッシュしません。この操作ごとの読み取りがhot updateの仕組みです。

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 説明

`describe(ref)`は値を公開せずに設定画面へ回答します。参照が解決されるか、どのレイヤーから解決されるか、現在`set`が成功するかを示します。local providerは、live process environmentから供給される参照を`writable: false`として報告します。書き込みが成功したように見えても解決結果はshadowing valueを返し続けるため、seamが拒否し、UIは最初から参照をread-onlyで表示できます。

```ts type-equiv
/** Source and writability facts for one reference, safe for configuration UIs — never the value. */
interface CredentialInfo {
  /** Whether {@link CredentialProvider.resolve} would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether {@link CredentialProvider.set} would currently succeed for this reference. */
  writable: boolean
}
```

## 変更コミット

`credentials/updated (ref)`は、プロバイダー管理ソースへの変更（`set`、`unset`、またはstorageで観測された外部編集）がコミットされた後に発火します。周囲のprocess environmentの変更は観測できず、発行されません。consumerは操作ごとに再解決するためイベントを必要としません。このイベントは、設定画面が「設定済み」バッジを更新するために存在します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service. Providers implement the four operations over their source layers; one seam-wide rule binds them all: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts:60`](../../packages/credentials/credentials/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsupdated--emit"></a>

#### `credentials/updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts:29`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
