# Filesystem

[English](filesystem.md) | [中文](filesystem.zh.md) | 日本語

任意のfilesystem capabilityは4つの部分から成ります。[dsh-fs](../../packages/fs/fs)は`ctx.fs`と任意guard付きのatomic text operationを所有し、[dsh-fs-local](../../packages/fs/fs-local)はlocal diskを実装し、[dsh-fs-observation-policy](../../packages/fs/fs-observation-policy)は観測した存在／不在を記録し、serviceではなくeventを通じてfreshness ruleを追加し、[dsh-tool-fs](../../packages/fs/tool-fs)はmodel向けread／write／edit callを直接実行してwindowをrenderします。agent-loop spineの外にあり、alternate backendはpolicyやtool schemaを変更しません。

`dsh-fs-observation-policy`は任意です。これがない場合、`FileSystem` Service Definition、provider、`dsh-tool-fs` Consumerが、制約のない完全なfilesystem seamを構成します。`write`は無条件にcreateまたはoverwriteし、`edit`は無条件にliteral textをreplaceします。policy pluginは`fs/*` waterfallを判断してこれらのoperationを変更します。toolはpolicy methodを呼ばず、`ctx.fs`を呼びeventをdispatchするため、このpluginを削除してもtoolは壊れません。`dsh-tool-fs`をloadするdeploymentは、default behaviorをread-before-write／editにするため`dsh-fs-observation-policy`もloadすることが期待されます。

Providerのsource：[`packages/fs/fs/src/types.ts`](../../packages/fs/fs/src/types.ts)と[`packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts)。Policyのsource：[`packages/fs/fs-observation-policy/src/types.ts`](../../packages/fs/fs-observation-policy/src/types.ts)。Read renderingのsource：[`packages/fs/tool-fs/src/read-render.ts`](../../packages/fs/tool-fs/src/read-render.ts)。

## Target識別情報とmetadata（providerの約束）

すべてのoperationは最初にuser-supplied pathをopaque backend targetへ解決します。consumerは`displayPath`を表示できますが、`targetKey`（branded opaque id）をparseしたりlocal absolute pathと仮定したりしてはいけません。

filesystemのexecution worldを共有するconsumerは、その識別情報を解釈せずproviderを通じてcapability間の座標を取得します。`processPath(target)`はsubprocessがopenできるcanonical absolute path、`fileUrl(target)`はprovider platformの`file:` URI、`contains(parent, child)`はcanonical identityまたはdescendant containmentの検査結果を返します。

```ts type-equiv
/**
 * A path resolved by a backend into a stable identity. `resolve()` produces
 * this; every other operation takes it.
 */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /**
   * Path for model/UI-facing output. May be a local absolute path,
   * workspace-relative path, or remote URI depending on the backend.
   */
  displayPath: string
}
```

backendはfile-version token（write／editがguardするfreshness token）を所有します。policy pluginはstale checkのため保存し、consumerは解釈しません。両方のidはbranded opaque stringです。

```ts type-equiv
/**
 * Opaque key for stale guards and target lookup. The local backend uses a
 * realpath-like string; a remote backend might use a workspace URI or file id.
 * Consumers MUST NOT parse it or assume it is a local absolute path.
 */
type FsTargetKey = Branded<'FsTargetKey'>
```

```ts type-equiv
/**
 * Opaque file-version token — the freshness token a write/edit guards against.
 * The local backend derives it from high-resolution stat identity and freshness
 * fields; a remote backend might use a revision id. The policy layer records it
 * for stale checks; consumers may display related metadata but MUST NOT
 * interpret this token.
 */
type FsVersion = Branded<'FsVersion'>
```

`stat`はmetadata（contentは返しません）を返し、targetがない場合は`undefined`です。`type`によりconsumerはread前にdirectoryとspecial fileをrejectでき、`size`によりtext consumerはfailureでprobeせず`readText`と`streamText`を選べます。text consumerは`streamText`をconsumeしながら自身のretention ceilingを適用します。raw-byte consumerは`readBytes(target, signal, maxBytes)`を使い、required complete-content capにより、既知または検出されたoverflowはtruncateや無制限bufferではなく`FS_TOO_LARGE`で失敗します。

```ts type-equiv
/**
 * Metadata about a target — what {@link FileSystem.stat} returns. Lets the
 * policy layer reject directories/special files before reading and choose
 * `readText` vs `streamText` from `size` without probing by failure. `version`
 * is the freshness token. `undefined` from `stat` means the target is absent.
 */
interface FsInfo {
  /** Opaque freshness token of the target right now. */
  version: FsVersion
  /** Whether the target is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

`lstat`はpath-levelのno-follow metadata primitiveです。stable identityを作る`resolve`は意図的にsymlinkをfollowするため、`FsTarget`ではなくpathを受け取ります。trust-boundary checkが必要なconsumerは先に`lstat`を呼び、resolve前に`symlink`をrejectできます。

```ts type-equiv
/**
 * Metadata about a path without following the final path component when it is a
 * symbolic link. Unlike {@link FsInfo}, this path-level probe can report
 * `symlink` so consumers with trust-boundary rules can reject repository-owned
 * links before resolving a target.
 */
interface FsPathInfo {
  /** Opaque freshness token of the path entry right now. */
  version: FsVersion
  /** Whether the path entry is a regular file, directory, symlink, or other. */
  type: 'file' | 'directory' | 'symlink' | 'other'
  /** Byte size of the path entry, when the backend can report it. */
  size?: number
}
```

`listDir`はdirect child entryをstable name orderで返します。各entryはchild basename、type、resolved target、backendが報告できる場合は安価なmetadataを持ちます。file contentをreadしてはいけないため、`size`はregular fileだけに、`version`はmetadata由来に限られます。壊れた、または消えたchildはmetadataなしの`other`として返してよく、listingまたはchild metadata解決中のpermission／backend IO failureは`FS_PERMISSION_DENIED`または`FS_IO_ERROR`でlisting全体を失敗させます。

```ts type-equiv
/**
 * One direct child returned by {@link FileSystem.listDir}. Listing returns
 * metadata and resolved targets only; it must not read file contents.
 */
interface FsDirEntry {
  /** Basename of the child inside the listed directory. */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Resolved child target for follow-up operations. */
  target: FsTarget
  /** Opaque freshness token when the backend can report metadata cheaply. */
  version?: FsVersion
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

## Writeとeditのguard（providerの約束）

`writeText`と`editText`はversion guardをOPTIONALLY受け取ります。無条件（bare-provider）のmutationでは省略し、guardする場合に指定します。`writeText`のguardは`FsWriteIntent`です。`createIfAbsent`はmissing targetをcreateし、existing targetを`FS_NOT_OBSERVED`でrejectします。providerのinitial probe後に現れたtargetも含みます。publication自体がno-replaceでなければならないためです。`replaceIfVersion`はtargetがobserved versionで存在する場合だけreplaceし、それ以外は`FS_STALE_VERSION`です。`expected`を省略すると無条件にcreate-or-overwriteします。union自体は2つのguarded intentだけを持ち、「guardなし」は省略で表すためwriteとeditは同じoptional `expected` fieldを使います。

```ts type-equiv
/**
 * Guarded write intent. `createIfAbsent` rejects an existing target with
 * `FS_NOT_OBSERVED`; `replaceIfVersion` rejects absence or mismatch with
 * `FS_STALE_VERSION`. Omitting the intent from `writeText` means unconditional
 * create-or-overwrite, not a third union arm.
 */
type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }
```

```ts type-equiv
/** Outcome of a full-file write. */
interface FsWriteOutcome {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: FsVersion
  /**
   * The file's content BEFORE the write, or `null` when the file did not exist
   * (a create) or the backend declined a contextual basis (for example, a
   * binary/non-UTF-8 prior file or either overwrite side reaching its exclusive limit).
   * LF-normalized storage text (the diff basis), never a diff — a consumer
   * computes the result-time contextual diff from `before`/`after` when
   * `before` is present, else falls back to a whole-file diff.
   */
  before: string | null
  /** The file's content AFTER the write, LF-normalized to share `before`'s diff basis. */
  after: string
}
```

`editText`はprovider-level mutationであり、別の場所でcomposeした`read`＋`write`ではありません。guard付きではliteral matchingのBEFOREにexpected versionを検証します（stale editは新しいcontentとのmatch failureではなく`FS_STALE_VERSION`を報告します）。unguardedではcurrent contentをeditします。どちらでもreplacementとatomic writeを適用し、matching、line ending handling、stale check、atomic replacementを1つのmutation critical section内に保持します。missing targetは両pathで`FS_STALE_VERSION`を報告します。

```ts type-equiv
/** A literal-replacement edit request. */
interface FsEditRequest {
  /** Literal non-empty text to replace. Must match exactly (after line-ending normalization). */
  oldString: string
  /** Literal replacement text. An empty string deletes the matched text. */
  newString: string
  /** Replace every match instead of requiring exactly one. */
  replaceAll: boolean
}
```

```ts type-equiv
/** Outcome of a literal edit. */
interface FsEditOutcome {
  /** Opaque version of the file after the edit. */
  version: FsVersion
  /**
   * The file's content BEFORE the edit. Raw storage text (LF-normalized by the
   * backend), never a diff — a consumer computes the result-time contextual diff
   * (the applied hunk with context) from `before`/`after`.
   */
  before: string
  /** The file's content AFTER the edit. */
  after: string
}
```

## fs policy event（providerの約束の語彙）

`dsh-fs`はtoolがdispatchしpolicy pluginがlistenする3つのeventを所有します。emitter（`dsh-tool-fs`）とlistener（`dsh-fs-observation-policy`）は、emitterがpolicy pluginに依存せず語彙を共有できます。eventは`dsh-fs`語彙とopaqueな`object` actorだけを持ち、model向けconceptやagent／session owner structureは持ちません。

`fs/write-intent`と`fs/edit-intent`は**single-slot decision waterfall**です。toolは`undefined`を返すdefault thunk（bare provider）付きでそれぞれdispatchし、listenerは`next()`を呼ばず完全に判断します。slotはregistration orderでfirst-winsです。これを所有するpolicy pluginはdeployment conventionであり、強制されたinvariantではありません。`fs/observed`はfire-and-forget recording eventで、`FsObservation`（version付きpresentまたはconfirmed absent）を運びます。通常の`ctx.emit`でdispatchし、listenerはMUST同期かつside-effect-onlyです。toolはemitをguardしないため、throwするlistenerはread errorを置き換えたり、mutation成功後にtoolの`isError` resultとして表面化したりする可能性があります。正確なsignatureは以下の生成[cordis surface](#cordis-surface)にあります。

```ts type-equiv
/**
 * One authoritative observation of a target. A present observation carries the
 * version used by guarded replacement; an absent observation authorizes only a
 * guarded create, never an edit.
 */
type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }
```

## Execution context（policy plugin）

policy pluginは、`fs/*` eventが運ぶopaqueな`object` actorをnarrowしてobserved-state ownerを導出するために必要な最小限のexecution contextを使います。`ToolExecution`がrequired fieldを持つため、`dsh-tool-fs`はtool、agent、session packageを`dsh-fs-observation-policy`がimportせずに、自身のexecution objectをactorとしてそのまま渡します。

```ts type-equiv
/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
```

## Read outcome（consumer／read rendering）

text readはline window、byte cap、backend limitでboundedされます。byte cap到達後もscanは継続しますが追加lineを保持しないため、`totalLines`は正確です。model向け`read` toolがrenderするresultは純粋にpresentationです。`full`／`partial` viewはありません。authorizationはfreshness-basedで、toolはstatのversion付きpresent `fs/observed`を直接emitします。そのためfileが変更されていなければ、windowed readでも後続write／editをauthorizeできます。metadata missはtoolが`FS_NOT_FOUND`を返す前にabsent observationをemitするため、後続guard付きwriteはexternally deleted targetを再作成できますがeditはauthorizeしません。readを所有するexecutor `dsh-tool-fs`がread windowingを実装してこのresultを構築し、policy pluginは行いません。

```ts type-equiv
/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
interface FileReadOutcome {
  /** 1-based first line requested. */
  offset: number
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes?: true
}
```

## Observed-file state（policy plugin）

observed stateは`dsh-fs-observation-policy` plugin内の`WeakMap<owner, Map<targetKey, FsObservation>>`です。map entryの欠落はunseenを意味します。`{ kind: 'absent' }`は`read`または`str_replace_editor`の`view`、`str_replace`、`insert`でmetadata missが発生し不在を確認した状態です。`{ kind: 'present', version }`はread、write、editがそのversionを観測した状態です。write decisionはunseenとabsentを`createIfAbsent`に、presentを`replaceIfVersion`に対応付けます。edit decisionはunseenを`FS_NOT_OBSERVED`、absentを`FS_NOT_FOUND`、presentをversion guardに対応付けます。ownerはevent actor（通常は`exec.agent.session`）から導出し、opaqueとして扱って決して読みません。disposeで全てをdropし（HMR safety）、policyはfilesystem IOを行いません。

## Error taxonomy（providerの約束）

filesystem failureは`FsError`（`HarnessError`）が運ぶstable `FsErrorCode` stringを使います。tool registryはerror result上の`{ name, code }`を保持するため、retry、permission、UI layerはtextをparseせず分岐できます。

```ts type-equiv
/**
 * Stable, machine-routable codes for filesystem failures. Carried on
 * {@link FsError}; the tool registry exposes `{ name, code }` on `isError`
 * results so retry/permission/UI layers can branch without parsing messages.
 */
type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_DIRECTORY'
  | 'FS_NOT_TEXT'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_TOO_LARGE'
  | 'FS_PERMISSION_DENIED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_IO_ERROR'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'
```

`FS_NOT_DIRECTORY`、`FS_PERMISSION_DENIED`、`FS_IO_ERROR`はdirectory listingで、既存だがdirectoryでないtarget、拒否されたlisting、予期しないbackend IO failureを区別します。`FS_SANDBOX_DENIED`はsandbox-enforcing backend（`dsh-fs-sandbox`）によるPOLICY refusalです。mode fenceがwrite／editを拒否したもので、host kernelが拒否する`FS_PERMISSION_DENIED`とは異なります。`FS_NOT_OBSERVED`はpolicy pluginにこのownerのprior-observation recordがないこと（または`createIfAbsent`がexisting fileに当たったこと）を示します。`FS_NOT_FOUND`はconfirmed absenceからrejectされたeditも表します。`FS_STALE_VERSION`はbackend versionがobserved versionと一致しなくなったこと（またはproviderがmissing targetへのeditを受け取ったこと）を示します。freshness authorizationにpartial／fullの区別はないため`FS_PARTIAL_OBSERVATION`はありません。

## File IOにtimeoutなし

`read`／`write`／`edit`は`timeoutMs`を**受け取らず**、providerの約束はdeadlineを設定しません。bashとweb（[`@deepseek-ai/dsh-timeout`](../../packages/util/timeout/README.md)を使う）やsubprocess-backed `glob`／`grep`（宣言された`timeoutMs`を`@deepseek-ai/dsh-tool-call-timeout-policy`が強制する）とは異なります。これらはprocess-backedでdeadlineがworkを実際にkillできます。local syscallは最大でもbest-effortでabort可能なだけです。timeoutでin-progressの`fsync`／`rename`を停止させることはできないため、ここでの`timeoutMs`はseamが強制できないdeadlineになります。またexplicit-over-implicitが禁じる正確な箇所にimplicit defaultを置くことになります。cancelは引き続きtool-execution signalを通じてsyscall boundaryでbest-effort abortまで伝播します。

## Serviceとplugin

`FileSystem`（`ctx.fs`、abstract）はprovider primitiveを所有します。`resolve`、`processPath`、`fileUrl`、`contains`、`stat`、`lstat`、`readText`、`streamText`、`readBytes`、`listDir`、`writeText`、`editText`です。`dsh-fs-observation-policy`は**serviceを登録しません**。`fs/*` event gateを通じてpolicyを追加するpluginです。unseen／absent／present stateからwrite／edit intent waterfallを判断し、`FsObservation` valueを記録します。executorは`dsh-tool-fs`で、`ctx.fs`経由でread／write／editし、waterfallをdispatchし、recording eventをemitします。正確なsignatureは以下の生成[`ctx.fs` section](#ctxfs--filesystem-abstract-seam)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfs--filesystem-abstract-seam"></a>

### `ctx.fs` — `FileSystem` (abstract seam)

Abstract filesystem provider. Targets must preserve identity across aliases; reads expose regular UTF-8 text or typed errors, listings are stable and content-free, and mutations are atomic. Optional guards add stale protection without changing the unguarded provider contract.

```ts cordis-catalog
/**
 * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
 * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
 * async even though the local backend only normalizes + realpaths.
 *
 * @param path - the path to resolve; relative paths resolve against `opts.cwd`.
 * @param opts - optional cwd override and cancellation signal.
 * @returns the stable target; the same file yields the same `targetKey`.
 */
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>

/**
 * Return the canonical absolute path a subprocess in this filesystem's
 * execution world can open. The path is deliberately separate from
 * {@link FsTarget.targetKey}: consumers may pass this value to another OS
 * capability, but must continue treating the target key as opaque.
 * @param target - the resolved target whose process path is required.
 * @returns an absolute path in the backend's execution world.
 */
abstract processPath(target: FsTarget): string

/**
 * Return the canonical `file:` URI for a target in this filesystem's
 * execution world. Backends own URI encoding because the host platform may
 * differ from the execution platform.
 * @param target - the resolved target to encode.
 * @returns the target's canonical file URI.
 */
abstract fileUrl(target: FsTarget): string

/**
 * Test canonical containment without exposing or parsing backend target
 * keys. Both targets must come from this provider.
 * @param parent - canonical directory target.
 * @param child - canonical candidate target.
 * @returns true when `child` is `parent` or a descendant of it.
 */
abstract contains(parent: FsTarget, child: FsTarget): boolean

/**
 * Return target metadata, or `undefined` when the target does not exist.
 * @param target - the resolved target to stat.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent target.
 */
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>

/**
 * Return path metadata without following the final path component when it is a
 * symbolic link. This is intentionally path-shaped, not target-shaped:
 * {@link resolve} follows symlinks to produce the stable identity used by
 * normal reads/writes, while `lstat` lets a consumer reject the path itself
 * before that follow happens.
 *
 * `opts.cwd` follows {@link resolve}'s cwd rules. `undefined` means the path is
 * absent.
 * @param path - the path to inspect; relative paths resolve against `opts.cwd`.
 * @param opts - `cwd` overrides the backend's default base for relative paths.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent path.
 */
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>

/**
 * Read the whole regular text file as a single decoded string.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @returns the full decoded UTF-8 content.
 */
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>

/**
 * Stream the whole regular text file as decoded text chunks (same text
 * semantics as {@link readText}, for large files). The backend owns
 * cross-chunk UTF-8 decoding and binary rejection so the policy layer never
 * touches raw bytes.
 * @param target - the resolved target to read.
 * @param signal - aborts the stream, including between chunks.
 * @returns the chunk iterable, decoded and validated like {@link readText}.
 */
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>

/**
 * Read the whole regular file as raw bytes with no decoding or binary
 * rejection. The bound lives at this seam so a backend can never buffer an
 * unbounded file: a target known or discovered to exceed `maxBytes` fails
 * with `FS_TOO_LARGE` instead of returning a truncated result.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @param maxBytes - inclusive byte cap on the complete content.
 * @returns the full raw content, at most `maxBytes` long.
 */
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>

/**
 * List direct children of a directory in stable name order. Returns resolved
 * child targets plus cheap metadata only; never reads file contents.
 * @param target - the resolved directory target.
 * @param signal - aborts the listing.
 * @returns one entry per direct child, in stable name order.
 */
abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>

/**
 * Atomically create or replace UTF-8 text. `expected` guards intent and
 * staleness; omission allows unconditional overwrite.
 * @param target - the resolved target to write.
 * @param content - the full new file content.
 * @param expected - the write intent guarding the write; omit for unconditional.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this write
 *   runs under; a sandboxing backend fences the write by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the write produced.
 */
abstract writeText( target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsWriteOutcome>

/**
 * Atomically edit literal text. When supplied, the version guard is checked
 * before matching so stale content reports `FS_STALE_VERSION`; omission edits
 * the current content without a freshness precondition.
 * @param target - the resolved target to edit.
 * @param edit - the literal search/replace request.
 * @param expected - the version guard; omit for an unconditional edit.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this edit runs
 *   under; a sandboxing backend fences the edit by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the edit produced.
 */
abstract editText( target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsEditOutcome>
```

Types: [SandboxExecutionPolicy](sandbox.md)

Source: [`packages/fs/fs/src/index.ts:86`](../../packages/fs/fs/src/index.ts)

<a id="fs-events"></a>

### `fs/*` events

<a id="fsedit-intent--waterfall"></a>

#### `fs/edit-intent` — waterfall

Single-slot decision for the next FileSystem.editText. Calling `next()` yields an unconditional edit; the first returned guard wins.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.editText}. Calling
 * `next()` yields an unconditional edit; the first returned guard wins.
 * @param target - the resolved target about to be edited.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
```

Source: [`packages/fs/fs/src/index.ts:66`](../../packages/fs/fs/src/index.ts)

<a id="fsobserved--emit"></a>

#### `fs/observed` — emit

Record an authoritative positive or negative observation. Listeners must be synchronous recorders: throws fail the tool call and returned promises are not awaited.

```ts cordis-catalog
/**
 * Record an authoritative positive or negative observation. Listeners must
 * be synchronous recorders: throws fail the tool call and returned promises
 * are not awaited.
 * @param target - the target whose presence or absence was observed.
 * @param observation - present with its version, or confirmed absent.
 * @param actor - the observing tool-execution context; undefined records nothing useful.
 * @mode emit
 */
'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
```

Source: [`packages/fs/fs/src/index.ts:76`](../../packages/fs/fs/src/index.ts)

<a id="fswrite-intent--waterfall"></a>

#### `fs/write-intent` — waterfall

Single-slot decision for the next FileSystem.writeText. Calling `next()` yields the bare provider's unconditional write; the first listener that returns an intent owns the decision rather than composing with peers.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.writeText}. Calling
 * `next()` yields the bare provider's unconditional write; the first listener
 * that returns an intent owns the decision rather than composing with peers.
 * @param target - the resolved target about to be written.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
```

Source: [`packages/fs/fs/src/index.ts:58`](../../packages/fs/fs/src/index.ts)
<!-- END GENERATED cordis-surface -->
