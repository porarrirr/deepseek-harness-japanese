# Permission Preset

[English](permission-presets.md) | [中文](permission-presets.zh.md) | 日本語

 [dsh-permission-presets](../../packages/interaction/permission-presets)（`ctx.permissionPresets`、`PermissionPresetService`）のpermission-preset layerは、独立した2つの強制設定（[sandbox mode](sandbox.md)（`sandbox/mode`）と[approval policy](approval.md)（`approval/policy`））をnamed presetにまとめ、clientが1つのPermissions selectorとして提示できるようにします。任意のcapabilityでありagent-loop spineの一部ではなく、強制処理を所有しません。execution、prompt narration、replayは引き続き各knobのfoldを読み、preset switchは意図を記録して各knobのcanonical setterに書き込むだけです。composition statusと制限は[package README](../../packages/interaction/permission-presets/README.md)、理由は[sandbox switching design](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)が管理します。

Source: [`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

## Preset table

presetは1つのsandbox／approval bundleと任意のclient presentationに対応するtable keyです。default tableには`workspace-write`（`workspace-write`＋`ask`）と`danger-full-access`（`danger-full-access`＋`never`）が含まれます。

```ts type-equiv
/** One preset's sandbox/approval bundle and optional client presentation. */
interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

```ts type-equiv
/** The {@link PermissionPresetService} config: preset table and composition default. */
interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}
```

serviceはconfining `ctx.shell` executorと`ctx.approval`を要求し、misconfigurationはplugin load時に失敗します。`custom`というtable entryはthrowします（このnameはderived not-a-preset state用に予約されています）。また、confinementを行わないbash executor（`sandboxMode` capability factなし）に重ねてcomposeするとthrowします。presetはsandbox modeをbundleするためです。

## Current presetとderived `custom`

`current(events)`は自身のeventだけでなくknobからeffective presetを導出します。sessionのeffective sandbox mode（executorのconfigured modeにfallback）とeffective approval policy（approval service config、さらに`ask`にfallback）をfoldし、まだ一致する記録済みselectionを優先し、次に宣言順で最初に一致するtable entryを使い、それ以外では`CUSTOM_PRESET`（`'custom'`）を返します。`custom`はderived-onlyです。clientはcurrent valueとして表示できますが、switch targetやevent payloadにはなりません。

`names`はtable宣言順にswitch可能なpresetを列挙します。`optionOf(name)`はtable key（labelがなければkeyにfallback）または`custom`についてclientがrenderするoptionを構築し、それ以外のnameではthrowします。

```ts type-equiv
/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}
```

## Switchと`permission/preset` event

`set(session, name)`はpresetを解決し（未知のnameはthrow）、`name`がすでにeffective presetでない場合にlog-onlyの`permission/preset` eventをappendします。その後、effective valueが変化したknobだけ、自身のsetter（[dsh-sandbox-policy](../../packages/sandbox/sandbox-policy)の`setSandboxMode`、[dsh-user-approval](../../packages/interaction/user-approval)の`setApprovalPolicy`）を通じて書き込みます。同じturn内ではselection eventがknob eventに先行し、effective presetを再選択した場合は何もappendしません。

`permission/preset`は永続化されるlog-onlyのuser intentです。model transcriptには入りません（knob eventがconsumerを通じてmodel-visible consequenceを所有します）。2つのpresetがbundleを共有するときに、ユーザーがどのpresetを選んだかを`current()`が保持できるよう存在します。`effectivePermissionPreset(events)`は最後のeventをfoldし、replayにcatch-up stateは不要です。完全なevent宣言は[persistence log event catalog](../persistence-catalog.md)、method signatureは生成された[service catalog](#ctxpermissionpresets--permissionpresetservice)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

Owns the deployment's permission presets and their write path. Requires a confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are reported as CUSTOM_PRESET, not an error.

```ts cordis-catalog
/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties; otherwise the first table match
 * wins, or {@link CUSTOM_PRESET} when no entry matches.
 * @param events - the session's events in log order.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(events: readonly SessionEvent[]): string

/**
 * Build the whole select value for one folded knob state: every table
 * option in declaration order, `custom` appended exactly while derived.
 * @param state - the folded knob overrides.
 * @returns the `permissions` projection payload.
 */
selectFor(state: KnobState): PermissionSelect

/**
 * Resolve a preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is not in the table.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
 * missing label falls back to the table key.
 * @param name - a table key, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a table key nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/interaction/permission-presets/src/index.ts:159`](../../packages/interaction/permission-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
