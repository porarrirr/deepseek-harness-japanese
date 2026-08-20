# Client Module

[English](client-modules.md) | [中文](client-modules.zh.md) | 日本語

web plugin tableは[dsh-client-modules](../../packages/client/modules)のclient module systemのNode halfで、`ctx.clientModules`（`ClientModuleRegistry`）として提供されます。host Loaderのentryから`dsh.client`を宣言するpackageをscanし、`window.__DSH_BOOT__` entry graphをcomposeし、各bundleを`/plugins/<id>/client.js`でserveし、index renderをtapしてboot manifestをinjectします。これが1つのserviceの4つの面です。web GUI stackの任意capabilityでagent-loop spineの一部ではなく、[dsh-host-webserver](../../packages/host/webserver)のconsumerです。[web-server.md](web-server.md)のcarrierがこのserviceが登録するprefix routeとindex tapを提供します。同じpackageのbrowser half（`ctx.modules`、bundleをfetchしてmaterializeするlazy-CJS module table）はkernel machineryであり、ここではなく[package README](../../packages/client/modules/README.md)に記載します。

Source: [`packages/client/modules/src/client/manifest.ts`](../../packages/client/modules/src/client/manifest.ts)

## Wire

graphはNode halfとbrowser halfのwire single sourceです。hostはscanしたpackageから`WebBootEntry` rowをcomposeし、`<head>`の最初のscriptとしてgraphをinjectします（`window.__DSH_BOOT__`。`<`をescapeするためplugin-controlled stringがscript elementの外へ出ません）。shellは何もbootする前にparseします。valid manifestのないpageはbootできず、browser-side parserはgraphの欠落またはmalformedで明確にthrowします。

```ts type-equiv
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation). `external` carries
 * module-graph edges: unlike `inject`, they constrain code arrival because
 * `require` is synchronous (see {@link WebBootGraph.entries}).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
  /** Non-baseline module specifiers this row requests; omitted when it requests none. */
  external?: string[]
}
```

```ts type-equiv
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /**
   * Composed entries in module-graph order — a dynamic package row precedes
   * rows whose `external` requests that package. Cordis activation order is
   * unrelated and remains owned by fiber service waiting.
   */
  entries: WebBootEntry[]
}
```

各rowの`rev`はbundleのcontent hashで、cache-busting queryとしてURLに乗ります。graph `rev`はcompose済みrowをhashするため、どのrowが変わっても変わります。`immediately`はstage-one prefetch tierを示し（module-face boot中にfetchとexecuteしregistrationだけ行います）、lazy rowは最初のimport時にfetchします。

## Scan

package.jsonで`dsh.client`（`platform: 'web'`、任意の`inject` edge、任意の`immediately`）を宣言し、built bundleを`exports["./client"]`でexportするとpackageがtableに参加します。package resolutionはconfig treeの`ctx.baseUrl`（cordis.yml directoryで、packageがcomposeする全pluginをdependencyとして宣言する）をanchorにし、anchorがunsetならconstructionがthrowします。

scanはpackageごとにincrementalで、full-rescan code pathはありません。Cordis `internal/plugin` emission（fiber constructionまたはdispose）ごとにfiberのentry nameをdirtyにし、microtask flushが各dirty nameをlive loader entryとreconcileします。activation passはcurrent entryをすべて同じdirty setにseedして同期flushするため、first scanとsteady stateは1つの実装を共有しますが、failure postureは逆です。activation時は既にload済みentryのmalformed declarationまたはmissing bundleを1つの大きな`AggregateError`にまとめ、壊れたpackageをすべて列挙します。fiberはFAILし、bootのfail-loud sweepが報告します。steady stateでは壊れたpackageをwarningとしてlogし、他をpoisonしてはいけません。

「client packageではない」というnegative verdictを含むpackage metadataはnameごとにcacheされ、expireしません。plugin-set変更はrestartで反映されます。fiber restartはrowとrevを変更せず再利用し、bundle content変更がgraphへ届くのは`rebuilt()`だけです。

## Bundle routeとindex tap

`GET`／`HEAD /plugins/<id>/client.js`は登録済みbundleをdiskから`no-cache`でserveします（整合性をanchorするのはHTTP cacheではなくrev queryです）。他のmethodは405です。unknown id、またはまだbuildされておらずbundleを読めない登録rowは、carrierのSPA fallbackがHTMLをJavaScriptとして返さないよう明確な404を返します。index tapは各index renderでcurrent graphをinjectするため、reloadすると常にlive compositionでbootします。

## Service

`ClientModuleRegistry`（`ctx.clientModules`、[`packages/client/modules/src/index.ts`](../../packages/client/modules/src/index.ts)で定義）はreadとrebuild faceを公開し、signatureは生成された[service catalog](#ctxclientmodules--clientmoduleregistry)にあります。`graph()`はcurrent composed graph（変更間はstable object）、`clientPath(id)`はbundleのabsolute pathを返します。`rebuilt(id)`がbundle contentをgraphへ到達させる唯一のentry pointで、fileを再hashし、実際にrevが変わった場合だけgraphをrecomposeしてnotifyします。`onRebuilt`は変更されたbundleごとにnew revを持って発火し、`onGraphChanged`はgraphをrecomposeしたflush（row add／remove、またはrebuilt rev change）の後に発火します。これはpull modelでlistenerは`graph()`を再読します。どちらのnotification pathもlistener exceptionを封じ込め、throwするsubscriberが後続subscriberをskipしたりflushのtriggerをkillしたりできません。

developmentでは[dsh-client-hmr](../../packages/client/hmr/README.md)がregistryのwatch driverです。node halfは同期的にcaptureしたbaselineからgraph rowごとのbundleをstat-pollし、変更時に`rebuilt(id)`を呼び、`onGraphChanged`を通じてwatch setをresyncし、SSEでbrowser halfへrev changeをbroadcastします。production graphはHMR rowを完全に省略し、module host自身はfileをwatchしません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxclientmodules--clientmoduleregistry"></a>

### `ctx.clientModules` — `ClientModuleRegistry`

The web plugin table service: incremental `dsh.client` scan + wire composition + bundle route + index tap. Construction runs the activation scan synchronously — a malformed declaration or missing bundle among the already-loaded entries aggregates into one loud throw (FAILED fiber; the boot activation audit reports it).

```ts cordis-catalog
/**
 * Current composed entry graph (stable object between changes).
 * @returns the graph served as `window.__DSH_BOOT__`.
 */
graph(): WebBootGraph

/**
 * Absolute path of an entry's client bundle.
 * @param id - entry id (package name).
 * @returns the path, or undefined for an unknown id.
 */
clientPath(id: string): string | undefined

/**
 * Re-hash one bundle (the HMR watch's registration hook — the only entry
 * point through which bundle content changes reach the graph).
 * @param id - entry id (package name).
 * @returns the new rev, or undefined for an unknown id.
 */
rebuilt(id: string): string | undefined

/**
 * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
 * @param listener - receives the entry id and its new bundle rev.
 * @returns the unsubscriber.
 */
onRebuilt(listener: (id: string, rev: string) => void): () => void

/**
 * Fires after any flush that recomposed the graph (row added/removed, or a
 * rebuilt rev change). Pull model: listeners re-read {@link graph}.
 * @param listener - notified with no payload.
 * @returns the unsubscriber.
 */
onGraphChanged(listener: () => void): () => void
```

Source: [`packages/client/modules/src/index.ts:295`](../../packages/client/modules/src/index.ts)
<!-- END GENERATED cordis-surface -->
