# Workspace

[English](workspace.md) | [中文](workspace.zh.md) | 日本語

workspaceはユーザーが作業するディレクトリの永続レコードです。正規化されたpathに対する安定したid、表示title、そのworkspaceに属するsessionの順序付きaccountを持ちます。このサブシステムは1つのパッケージ（[dsh-workspace](../../packages/workspace/workspace)、`ctx.workspaceRegistry`）であり、任意のhost側capabilityです。agent-loop spineの一部ではなく、モデルからは見えません（tool、prompt text、session eventはありません）。レコードは[storage domain form](storage.md)を通じて保存し、[`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log)に対してsession membershipを検証します。そのため`storageDomain`と`sessionPersistence`は起動時の必須依存関係です。persistence peerが利用できない場合は空の履歴と誤認せず、pluginをpendingのままにします。設計記録は[domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)、bootstrapとGUIの順序は[Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md)です。

Source: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 識別情報

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId`は[branded id](core.md#branded-ids)です。pathの識別情報は別です。`realpathNormalize`（`fs.realpath`、末尾slash、`..`、symlinkを解決）が唯一の一意性canonです。workspace pathは正規化して保存し、正規化済みpathの文字列等価性で一意性を判定します（所有済みディレクトリへのsymlinkは衝突します）。attach時のsession cwdチェックも同じcanonを通ります。

## Workspaceエンティティ

consumerが見るのは`Workspace`インターフェースだけであり、実装はパッケージ内に留まります。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有の事実はレコードの順序付き`sessionIds`であり、session cwdから導出することはありません。ただしmembershipには、account上のidと、正規化されたcwdがworkspace pathと等しいheaderの両方が必要です。そのため1つのsessionが構造上所属できるworkspaceは最大1つです。書き込みに失敗すると拒否します（`insertSessionBefore`のaccountエラーは`WorkspaceMoveInvalidError`、storage failureは通常のerror）。受理された各変更は`updatedAt`を記録し、membershipチェックを通過しなくなったcandidateを永続的にpruneします。

## レジストリ：`ctx.workspaceRegistry`

`WorkspaceRegistry`（[signatures](#ctxworkspaceregistry--workspaceregistry)）は登録と解決を所有します。`create(path, title?)`はpathを正規化し、存在しないpath（元の`ENOENT`）またはdirectoryでないpathを拒否します。正規化済みpathがすでに所有されていれば既存entityを変更せず返し、それ以外では`title ?? basename(path)`を持つレコードを永続レジストリ順の先頭に追加します。新しいレコードは既存の表示titleを重複させられません（`WorkspaceNameConflictError`）。`get(id)`と順序付き`list()`は同期的なcache readであり、`resolveByPath(path)`は作成せず同じrealpath canonを適用します。`delete(id)`が削除するのは登録、順序entry、session accountだけです。directory、user file、live session、永続logには触れないため、sessionはUngroupedになります（[decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)）。未知のidは`false`を返します。createとdeleteは、2つの書き込み（record＋order）が分岐する前にpending-mutation markerを永続化します。起動時にはそのmarkerが示す変更を正確に解決します。markerのtable rowを削除することで、中断したdeleteを完了し、中断したcreateをrollbackします（登録は再作成できるためrollbackが安全です）。markerのないorder/table不一致はcorruptionとして明確に失敗します。

Sessionはこのregistryからではなく、作成者から作成時にcwdを受け取ります。API gatewayは選択されたworkspaceの`path`から新しいsessionのcwdを解決し（明示またはdefault cwdにfallback）、cwdが不変の[`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log)に入るようsessionを作成してから`attachSession`を呼びます。`attachSession`は保存されたheader cwdをworkspace pathに対して再検証します。最初の起動に成功すると、registryは永続headerだけ（`id`、`cwd`、`createdAt`であり、event bodyは使いません）からhistoryをbootstrapし、正規cwdを持つsessionをディレクトリごとのworkspaceに新しい順でグループ化します。initialized markerは最後に書き込むため、中断したbootstrapを安全に再開できます。bootstrapは一度だけです。cwdのないlegacy sessionはUngroupedのままで、その後に作成されたsessionは`attachSession`を通じてのみworkspaceに参加します。

## Consumer

[dsh-host-apiproxy](../../packages/host/apiproxy)が製品consumerです。`ctx.workspaceRegistry`を通じてGUI clientにworkspace CRUDを提供し、前述のcreate-session-then-attachフローを実行します。[dsh-agent-instructions](../../packages/context/agent-instructions)は名前に反して**consumerではありません**。agent自身のcwd配下にあるAGENTS.md形式のinstruction fileを検出しますが、`ctx.workspaceRegistry`には触れません。共通する語はユーザーの作業ディレクトリを指し、このregistryのentityを指すものではありません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (abstract seam)

Abstract directory-picking service. Subclass, implement `capability()`, and load the subclass as a plugin — it registers as `ctx.directoryPicker` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). The capability object must be stable for the service lifetime: consumers may capture it across calls.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

Source: [`packages/host/directory-picker/src/index.ts:131`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

Durable workspace registry. Startup waits for `sessionPersistence`, builds one canonical-cwd header index, and completes the one-time history bootstrap before the service becomes active. The persistence dependency is mandatory so an unavailable peer can never be mistaken for an empty history and commit the initialized marker.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/workspace/workspace/src/index.ts:92`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
