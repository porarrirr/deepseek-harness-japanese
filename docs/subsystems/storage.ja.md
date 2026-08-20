# Storage

[English](storage.md) | [中文](storage.zh.md) | 日本語

storageサブシステムはsession event logではないすべてのものを永続化します（session logには独自のseamがあります。[persistence.md](persistence.md)を参照）。これはagent-loop spineの一部ではない1つの任意capabilityで、[capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)として分割されています。hubとService Definition（[dsh-storage](../../packages/storage/storage)、`ctx.storage`）、Service Provider（[dsh-storage-json](../../packages/storage/storage-json)は`json`として登録、[dsh-storage-sqlite](../../packages/storage/storage-sqlite)は`sqlite`として登録）、Consumer data form（[dsh-storage-domain](../../packages/storage/storage-domain)、`ctx.storageDomain`、`ctx.storage.domain`からも到達可能）で構成されます。data formはbackend contractに対する唯一のConsumerであり、他のすべてが使うtyped APIです。hub自体はIOを行いません。backendがmediaを、data formが意味を所有し、product packageはbackendに直接触れません。設計記録は[domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)です。

Source: [`packages/storage/storage/src/backend.ts`](../../packages/storage/storage/src/backend.ts) · [`packages/storage/storage-domain/src/spec.ts`](../../packages/storage/storage-domain/src/spec.ts) · [`packages/storage/storage-domain/src/events.ts`](../../packages/storage/storage-domain/src/events.ts)

## Hub：`ctx.storage`

`Storage`（[signatures](#ctxstorage--storage)）はstoreではなくmeeting pointです。`ctx.storage.backend`はname → backend tableです。複数のbackendを横並びでmountでき、どのbackendがどのconsumerにサービスするかはconsumerの設定（domain layerのroute table）で決まり、hub全体の選択ではありません。`register(name, backend)`はdisposerを返し、重複名と未知のlookupは`StorageError`をthrowします。disposeはnameの登録を解除するだけで、owner pluginが解除後にbackendをcloseします。各backend pluginはlifecycle専用service key（`storageBackendServiceKey(name)`）も公開し、form providerがinjectすることでactivationがbackend登録と競合しないようにします。

data formはmerge-extensible key mapの下でhubにmountされます。

```ts type-equiv
/**
 * Data forms mountable on the hub, keyed by form name. Form owners extend
 * this map via declaration merging (the domain layer merges
 * `domain: DomainFacility`) and mount the facility in their `apply`.
 */
interface StorageForms {}
```

`mount(form, facility)`はdisposerがunmountするeffectです。同じkeyを2回mountすると`duplicate-mount`をthrowします。`form(form)`はmountされたfacilityを解決し、owner pluginがloadされるまで`form-not-mounted`をthrowします。assemblyは黙って遅延せず、それに応じてpluginを順序付けます。domain layerは`domain: DomainFacility`をmergeするため、`ctx.storage.domain`と`ctx.storageDomain`は同じobjectです。

## Backendの約束

```ts type-equiv
/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  readonly kv?: KvFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void>
}
```

backendは1つのmedium（file-tree rootやdatabase file）を所有し、任意のoperation groupを公開します。現在のgroupは`kv`だけです。`KvFacet.open(descriptor)`は名前付きunitを1つ開き、`KvUnitDescriptor`はname、format version、table name、global singleton slotの有無を持ちます。そして`loadAll`、`putRecord`、`deleteRecord`、`setGlobal`、`close`を持つ`KvUnit`を返します。unitとtableの名前は`UNIT_NAME_RE`に一致しなければなりません（file nameおよびSQL identifier segmentとして安全）。record keyは任意の文字列で、file pathには到達しません。unitは並行書き込みを直列化しません（順序は呼び出し側が所有します）が、各単一呼び出しはmedium上でatomicで、解決後に永続化されます。異なるversionが記録されたmediumは`version-mismatch`を拒否し、unitとして解析できないmediumは`malformed-medium`を拒否します（migrationなし、pre-release stance）。[`backend.ts`](../../packages/storage/storage/src/backend.ts)が条項ごとの規範的な約束であり、[`tests/contract.ts`](../../packages/storage/storage/tests/contract.ts)の共有conformance suiteが各backendに対して全条項を検査します。[json backend](../../packages/storage/storage-json/README.md)はunitごとに人間が読めるファイル全体をatomicに再公開し、[sqlite backend](../../packages/storage/storage-sqlite/README.md)は頻繁に更新されるデータを1つのdatabaseのrowごとに保存します。

## Domainの宣言

domainはowner packageがspec objectとして1回宣言します。これはdomainの識別情報、layout、record schemaのsingle sourceです（zodを使うため`z.infer`によりconsumer typeの重複を防げます）。

```ts type-equiv
/** Static declaration of one domain: identity, version, and record layout. */
interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  readonly tables: Record<string, DomainTableSpec>
}
```

`defineDomain(spec)`はspecのliteral typeを固定し、mediumに触れる前、ownerのmodule load時に明確に失敗します。`UNIT_NAME_RE`外のdomainまたはtable name、non-negative integerでないversion、`null`を受け入れるglobal schemaはすべてthrowします（`null`はmediumの「未書き込み」sentinelであり、nullable globalを保存するとround-tripできません）。`domainTable<K, V>(schema)`はphantom compile-time key type（通常は[branded id](core.md#branded-ids)）を持つtableを1つ宣言し、`descriptorOf(spec)`はbackend向けunit descriptorを投影します。

## Open domain

```ts type-equiv
/** One open domain, typed by its spec. */
interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}
```

読み取りは権威あるmemory stateから同期的に行います。`KvTable`は`get`／`entries`／`keys`／`size`を公開します（キューに入った書き込みが到着しても安定したsnapshot iterator）。global handleの`get()`は、最初の`set`がmedium上のslotを具体化するまでspecの`initial`を返します。すべての書き込み（`put`、`delete`、`update`、`global.set`）はdomainごとの1つのchainにqueueされ、まずbackend永続化に到達し、次にmemoryを変更し、その後`domain/changed`を発行します。backend writeが拒否された場合memoryは変更されないため、読み取りがmediumと分岐することはありません。`update(key, fn)`はchain slotでatomicなread-modify-writeを行い、keyがない場合は`missing-key`を拒否します。存在しないkeyの`delete`は書き込みとeventなしで`false`に解決します。返されるrecordはcopyではなく保存されたobject自体です。`put`／`update`で置換し、in-placeで変更しないでください。

## Domain facility：`ctx.storageDomain`

`DomainFacility`（[signatures](#ctxstoragedomain--domainfacility)）はrouteされたbackend上で宣言済みdomainを開きます。routingはhubではなくdomain pluginの設定です。`backend`は必須のdefault routeを指定し、`routes`はdomain nameごとに上書きします。`open(spec)`はstrict sequenceで実行され、各stepが呼び出し全体を失敗させます。すでにopen中またはclosing中のname（`already-open`）を拒否し、routeを解決し（`backend-not-found`）、backendの`kv` facetを要求し（`facet-unsupported`）、unitを開き（backendの`version-mismatch`／`malformed-medium`はそのまま伝播）、保存された全recordとglobalをspecのzod schemaに対して検証します（問題のtableとkeyを持つ`invalid-record`）。返されたhandleは呼び出し側が所有し、`Domain.close()`で解放します。pluginのunmount時にopenのdomainはfacilityがcloseし、closed domainのnameはteardownが完全に終わってから再open可能になります。`get(name)`は各typed handleの背後にあるpackage-private `DomainImpl` runtimeへのuntyped diagnostic lookupであり、`closeAll()`はunmount経路です。

## 変更イベント：`domain/changed`

すべての永続書き込みは、backendが永続化を確認した直後に、domainのwrite-chain順で1つのeventを発行します（[event entry](#domainchanged--emit)）。

```ts type-equiv
/** Shared location fields of one durable domain change. */
interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}
```

```ts type-equiv
/** One durable domain change; a closed union — switch on `operation`. */
type DomainChanged = DomainChangedPut | DomainChangedDeleted
```

`put`（insert、overwrite、global write）は新しいsnapshotを`value`に持ち、古い値は持ちません。diffを行うconsumerは自身のprevious snapshotを保持します。`deleted`はvalueを持たないtombstoneです。このeventはnotificationでありtransaction participantではありません。発行時点でcommit pointを過ぎているため、同期throwするlistenerは、すでに永続化された書き込みを拒否せず、ログ付きwarningで封じ込めます。発行されたvalueは発行時点のmemory stateと等しくなります。eventはプロセス内だけであり、プロセス間の変更pushは記録済みの制限です（[package README](../../packages/storage/storage-domain/README.md)）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxstorage--storage"></a>

### `ctx.storage` — `Storage`

The storage hub service. Backends register under `backend`; data forms mount under their `StorageForms` key and are reached as `ctx.storage.<form>`.

```ts cordis-catalog
/**
 * Mount a data-form facility on the hub. Mounting is an effect: the
 * returned disposer unmounts the form.
 * @param form - Form key declared in {@link StorageForms}.
 * @param facility - The facility instance to expose.
 * @returns the disposer that unmounts the form.
 */
mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void

/**
 * Resolve a mounted data form.
 * @param form - Form key declared in {@link StorageForms}.
 * @returns the mounted facility.
 */
form<K extends keyof StorageForms>(form: K): StorageForms[K]
```

Source: [`packages/storage/storage/src/index.ts:47`](../../packages/storage/storage/src/index.ts)

<a id="ctxstoragedomain--domainfacility"></a>

### `ctx.storageDomain` — `DomainFacility`

The mounted domain facility. Opens declared domains over routed backends; one facility instance owns the open-domain table and enforces single-open per domain name.

```ts cordis-catalog
/**
 * Open one declared domain. Steps, each failing the whole call: reject a
 * name that is already open (`already-open`); resolve the backend route
 * (`backend-not-found` passes through from the hub); require its `kv` facet
 * (`facet-unsupported`); open the unit projected from the spec (backend
 * `version-mismatch`/`malformed-medium` pass through); load and validate
 * every stored record against the spec's zod schemas (`invalid-record`
 * with the offending table and key); construct the domain.
 *
 * Lifecycle: the CALLER owns the returned handle and closes it via
 * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
 * facility does not tie the domain to any consumer fiber. Domains still
 * open when the facility unmounts are closed by the plugin disposer.
 * @param spec - The domain declaration, typically from `defineDomain`.
 * @returns the opened domain handle, typed by the spec.
 */
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>

/**
 * Look up an open domain by name, untyped. Diagnostic surface (the package
 * invariant cross-checks change events against live domain state); typed
 * consumers hold the handle returned by {@link open}.
 * @param name - Domain name.
 * @returns the open domain runtime, or `undefined` when not open.
 */
get(name: string): DomainImpl | undefined

/**
 * Close every domain still open on this facility. The unmount path for
 * consumers that never called `Domain.close()` themselves; closing is
 * idempotent, so double-closing an already-closed domain is harmless.
 * @returns resolution after every unit is released.
 */
async closeAll(): Promise<void>
```

Source: [`packages/storage/storage-domain/src/index.ts:69`](../../packages/storage/storage-domain/src/index.ts)

<a id="domain-events"></a>

### `domain/*` events

<a id="domainchanged--emit"></a>

#### `domain/changed` — emit

A domain record or the global singleton changed, emitted once per write strictly after the backend acknowledged durability. Events of one domain arrive in its write-chain order.

```ts cordis-catalog
/**
 * A domain record or the global singleton changed, emitted once per write
 * strictly after the backend acknowledged durability. Events of one
 * domain arrive in its write-chain order.
 * @param change - domain, table (`''` for global), key (`''` for global),
 * operation discriminant, and on `put` the new snapshot.
 * @mode emit
 */
'domain/changed'(change: DomainChanged): void
```

Source: [`packages/storage/storage-domain/src/events.ts:46`](../../packages/storage/storage-domain/src/events.ts)
<!-- END GENERATED cordis-surface -->
