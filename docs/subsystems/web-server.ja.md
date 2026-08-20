# HTTP Server

[English](web-server.md) | [中文](web-server.zh.md) | 日本語

[dsh-host-webserver](../../packages/host/webserver)はGUI host向けのbrowser HTTP carrierです。`ctx.webServer`、named-route registry、index.html transform callback、pluginがclaimできるfallback handlerを1つ提供する単一の`node:http` pluginです。agent loopの一部でもcapability seamでもなく、harness conceptを知りません。`/api` bridge、plugin bundle、HMR event streamを含むすべてのfeature routeは別のpluginが登録します（[layering note](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)）。browserだけにserveします。Electronはbuilt fileを`file://`でloadし、fetch requestをこのserverではなくIPC bridge経由で送ります。

Source: [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

## Route

```ts type-equiv
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
type WebRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named route registration. */
interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

match順は固定です。exact table、最長一致prefix、登録済みfallbackの順です。registration orderはrequest-facing semanticsを持ちません。named routeはdisjointになるようcomposeされ、fallback seatはnamed routeがclaimしなかったものに応答します。ownerは1つだけで、2回目のregistrationはthrowします。提供されるWeb compositionは[`dsh-host-frontend-static`](../../packages/host/frontend-static/src/index.ts)がseatをclaimし、SPA dist serverを固定semanticsで提供します。GET／HEAD以外は405、dist root外のtraversalは403、missは`index.html`へHTTP 200でfallback（SPA routing）し、未知のextensionはoctet-streamで返します。

## 設定

```ts type-equiv
/** Gateway config: the listen address. */
interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

`host`は`127.0.0.1`（default posture）と`0.0.0.0`（意図したnetwork exposure）だけを受け入れます。TLS、auth、origin policyはないため、non-loopback bindはそのnetworkにserverを公開します。dist locationはseatをclaimするfrontend pluginのassembly factです。

## Service

`WebServer`（`ctx.webServer`）はactivation時に直ちにlistenします。listen failure（EADDRINUSE…）はinitializationをrejectし、boot processはfailed fiberを報告します。`register(route)`はnamed routeを1つ追加してdisposerを返します。route patternはcomposition-level contractでcollisionはmisconfigurationなので、重複`(kind, path)`はthrowします。`tapIndex(transform)`はpure html-to-html transformを追加し、すべてのindex response（`/`と各SPA fallback）にregistration順で適用します。[dsh-client-modules](../../packages/client/modules)はこれを使ってboot manifestをinjectします。`port`はlisten portを読み、`config.port`が0のときOSが割り当てたportも含みます。

処理中にthrowしたrequest（`decodeURIComponent`に到達するmalformed %-escape、body途中で切断したclient）はwarningとしてlogし、400を返します。header送信済みならsocketをdestroyします。process exitにはしません。handlerがresponseをopenしたまま保持でき（SSE）、connectionが自動終了しないため、disposeは`close()`と`closeAllConnections()`を組み合わせます。force-closeがなければteardownがhangします。packageはURL lineをprintしません。URL lineはshellが所有します。dev-mode bundle watch pipelineなどpackageごとの運用詳細は[README](../../packages/host/webserver/README.md)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

The browser HTTP carrier service. Activation listens immediately. Route registration order does not affect requests because configured named routes must be distinct, and the fallback handler answers anything not yet claimed during startup with 404 until its owner registers. A listen failure rejects initialization, and the boot process reports the failed fiber.

```ts cordis-catalog
/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler.
 * @returns the disposer removing the route.
 */
register(route: WebRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler answering every request no named
 * route matches (the SPA dist server in the shipped Web composition). One
 * owner only — a second registration throws, because two fallbacks cannot
 * compose.
 * @param handler - owns the full response lifecycle of unmatched requests.
 * @returns the disposer releasing the seat.
 */
registerFallback(handler: WebRoute['handler']): () => void

/**
 * Register an index.html transform, applied by the fallback owner to every
 * index response ({@link applyIndexTaps}) in registration order.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string
```

Source: [`packages/host/webserver/src/index.ts:59`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
