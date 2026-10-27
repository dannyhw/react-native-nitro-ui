# Q1 — Menu (G7a) design — 2026-10-27

Read-only research. Repo claims name `file:line`; other repos name a version.
Methods note: nothing was built or run. Two facts I could not get from text were read out of
already-downloaded artifacts instead — `javap` on the resolved material3 AAR in the Gradle cache, and
the `SwiftUI.swiftinterface` inside Xcode 27's iPhoneOS 27.1 SDK — both read-only, both cited below.

## 1. Public API

`Menu` is **a button that opens a list of actions**. Follow `Button`
(`src/components/Button/Button.tsx`), *not* `Picker`: a menu has no value, so no `useControlled`
and no event-count handshake — exactly `Button`'s own reasoning (`Button.nitro.ts:17-19`,
`docs/architecture/core.md` §12). Open state is **not controlled**: it is native-owned and observed
through `onOpen`/`onClose` (open question A).

```ts
// src/components/Menu/Menu.tsx  (public surface)
export interface MenuProps extends ViewProps {
  title: string;                                   // trigger label; default a11y label
  group: MenuGroup;                                // the items, as data
  variant?: ButtonVariant; size?: ButtonSize;      // reuse Button's trigger
  disabled?: boolean; systemImage?: string; tintColor?: ColorValue;
  onSelect?: (id: string) => void;
  onOpen?: () => void; onClose?: () => void;
  primaryAction?: () => void;                      // iOS only — see §2, question D
}
export interface MenuGroup  { actions?: (MenuAction | MenuSubmenu)[]; sections?: MenuSection[] }
export interface MenuAction { id: string; title: string; disabled?: boolean; destructive?: boolean; systemImage?: string }
export interface MenuSubmenu { id: string; title: string; systemImage?: string; items: MenuAction[] }
export interface MenuSection { id: string; title?: string; items: MenuAction[] }
```

Native spec: every prop `T | null`, callbacks the only `fn?` (`Button.nitro.ts:24-61`, lint
`no-optional-view-props` at `eslint-rules/index.js:303`, `no-anymap-in-spec` :184,
`no-json-string-prop` :218). `hybridRef` read-only and `@internal` (D14). `alignSelf:
'flex-start'` base style (`Button.tsx:146`).

Items travel as a **named struct array**, never JSON: nitrogen turns a named `interface` into a C++
struct with a generated `JSIConverter` (`node_modules/nitrogen/src/syntax/createType.ts:406-424`;
compare `nitrogen/generated/shared/c++/NitroUiButtonSize.hpp`), and struct vectors stay equatable
(`StructType.isEquatable`), so `group` becomes `ReactProp<MenuGroup>` — not a string. Verified for
arrays today at `nitrogen/generated/shared/c++/views/HybridNitroUiPickerComponent.hpp:50-81`
(`ReactProp<std::vector<std::string>>` + `hasSameValue`, compared *after* conversion). So the
wrapper must hand back one stable array identity: props diff by identity in JS and unmemoized
arrays re-convert every render (`docs/research/nitro-patterns.md:25-27`). Depth is capped at
**one** submenu level, and `id` is required on every row: the sizing key and the tests need
something that survives a re-ordered list.

## 2. iOS — SwiftUI `Menu` in `ios/core`

`MenuContent: NitroUIContent` over one `MenuModel`, in the existing
`NitroSwiftUIHost<MenuContent>`. The core already expects this control: the containment flag's own
doc says "components that present something (Picker menu, DatePicker, **Menu**)"
(`ios/core/NitroSwiftUIHost.swift:62-65`). Init is Picker's init: `wantsContentSize = true`,
`sizingPolicy = .intrinsic`, `needsContainment = true`
(`ios/components/Picker/HybridNitroUiPicker.swift:279-284`) — Button's `false`
(`ios/components/Button/HybridNitroUiButton.swift:232`) is wrong here.

Trigger: `Menu { rows } label: { ButtonLabel(model) }`, reusing Button's label composition
including `Label`+`Image(systemName:)` (`HybridNitroUiButton.swift:126-136`), so the box *is* a
Button's box. `.menuStyle(.button)` (iOS 16) and `.menuIndicator(.hidden)` (iOS 15) both exist in
the iPhoneOS 27.1 SDK interface (`SwiftUI.swiftinterface:11175`, `:25988`); gate with `#available`
per `docs/research/setup-decisions.md:196`. `primaryAction` is `Menu(content:label:primaryAction:)`,
iOS 15+ (`:8776-8791`), giving the native idiom "tap acts, long-press opens". Destructive:
`Button(role: .destructive)` per row (`:11764`); sections/dividers: `Section` + `Divider` render as
menu groups.

What UIKit does underneath matters for testing: SwiftUI hands the menu to the **system's**
presentation, so our `UIHostingController` never owns a window and the measure only ever sees the
button. Picker already reports that as all-`-1` (`HybridNitroUiPicker.swift:555-565`) — do the same,
never a `0` that reads as "checked".

A11y: `content.accessibilityLabel(label)` applied only when set (`OptionalPickerAccessibility`,
`HybridNitroUiPicker.swift:215-229`); rows keep SwiftUI's own names and check mark
(`docs/components/picker.md` Accessibility). Do **not** put `testID` on the SwiftUI element — RN
already sets `accessibilityIdentifier` (`core.md:163-178`).

## 3. Android — Compose `DropdownMenu` inside our host

`MenuHost : NitroComposeHost<MenuModel>` with `Component(model)` = `Box { trigger; MenuWitness(model);
DropdownMenu(expanded, onDismissRequest) { rows } }`; `expanded` is `mutableStateOf` like
`HybridNitroUiPicker.kt:107`. Every piece of H2b's popup engineering transfers, because the popup is
the composition's own window (`docs/tasks/H2b-host-popups.md:11-18`, `docs/components/host.md:195-232`,
`src/components/Host/HostChildren.ts:56-83`):

- **Anchoring**: `val compositionView = LocalView.current` (`HybridNitroUiPicker.kt:699`), the
  RN-placed ancestor via `placedViewOf` + an `OnLayoutChangeListener` (`:709`, `:923-929`), the
  anchor box via `onGloballyPositioned { boundsInRoot }` (`:752`), and **dismissal on a layout move**
  through `dropOpenMenu()` (`:286-290`; `docs/components/host.md:220`). A scroll must not dismiss.
  Use `Modifier.clickable` + semantics as the trigger (no `menuAnchor` — that belongs to
  `ExposedDropdownMenuBox`, `:743`).
- **Leak witness**: `MenuWitness` as the *first* child of the menu content, a `DisposableEffect` over
  a process-wide `liveMenus` that also clears the rect and `expanded` on dispose
  (`:885-911`, `:410`).
- **Sizing hazard**: `intrinsic` asks Compose unbounded and scrollable content throws there
  (`core.md:423-425`). Safe only because Compose's `DropdownMenu` is a separate window — verified in
  material3 `1.4.0` (`AndroidMenu_androidKt` references `androidx.compose.ui.window.AndroidPopup`
  and `PopupPositionProvider`, from the resolved AAR).
- **a11y**: copy the *one-node* fix, not the naive one. Plain `semantics` leaves a nameless focusable
  node beside the named one (G6 M3); `clearAndSetSemantics` carrying `contentDescription`,
  `SemanticsProperties.Text`, `stateDescription`, `role = Role.DropdownList` and
  `onClick`/`disabled()` is what made `uiautomator dump` report one node
  (`HybridNitroUiPicker.kt:759-793`). `testID` → `host.tag` (`core.md:163-166`).

## 4. `@expo/ui` 58.0.22 — copy / avoid

It wraps SwiftUI `Menu` (`ios/Menu/MenuView.swift`, 43 lines) and Compose `DropdownMenu`
(`android/.../menu/DropdownMenu.kt`, 50 lines) with **menu items as child RN views** behind named
slots (`label`, `items`, `text`, `leadingIcon`, `trailingIcon`).

- **Copy**: primary-action behaviour and its wording ("a single tap triggers this, a long-press shows
  the menu" — `MenuView.swift:22-30`, `src/swift-ui/Menu/types.ts:20-24`); the dismissal vocabulary
  `ActivationMethod` / `ExpoPopupProperties{focusable, dismissOnBackPress, dismissOnClickOutside,
  clippingEnabled}` (`DropdownMenuRecords.kt:12-33`) is worth naming when a prop is asked for; and
  the proof that anchoring a popup inside a shared host works (`docs/components/host.md:204-208`).
- **Avoid**: items as child views (kills items-as-data, and needs a hand-written `ViewGroupManager`,
  `nitro-patterns.md:18-21`); union props like `label: string | ReactNode` (`types.ts:13`) — Nitro
  cannot represent them; `MenuDefaults.itemColors()` inside the composable (`DropdownMenu.kt:51`), a
  per-recomposition allocation against `core.md:133-159`; a JS-owned `expanded` prop round trip.

## 5. Sizing, recycling, leaks, tests

`intrinsic`, with `nuiSizingKey` = Button's `variant|size|systemImage|title` (`Button.tsx:126-133`).
**`group` is excluded** — it never changes the trigger's box, and free-form text in a key fragments
the cache. One row in the manifest plus the generated fallback tables
(`ios/core/NitroUiDeclaredFallbacks.swift:30-36`, `.../core/NitroUiDeclaredFallbacks.kt:37-43`), and
the declared fallback must be **different** from the fixture's measured size
(`docs/tasks/X4-conformance.md:36-38`). Recycle: full `reset()` with `expanded` first, plus
`onDropView` dropping callbacks and disposing the composition — the thing that closes the window. No
new registrations; the strategy and pre-draw listeners stay the host's (`core.md:269-306`).

Harness (`example/__tests__/Menu.harness.tsx`, shaped by `Picker.harness.tsx` +
`HostPopups.harness.tsx`): `onOpen`/`onClose` exactly once each and never for a pick; one `onSelect`
per pick; a `disabled` row and an open-then-disable report nothing, each proven with the **barrier
twin** (`core.md` "Assert a non-event with a barrier"); `group` shrinking while open reports
`rows=N`; drop-while-open leaves `liveMenus == 0`; recycle carries no old state; colour round-trip;
`measureContent()`; perf marks. Android adds the anchor/menu rect pair and layout-move dismissal.
`component.json` (`sizing: "intrinsic"`, `hostable: true`, `realInput: true`) makes X4's four rules
run automatically, the a11y one through `scripts/real-input/uiautomator.mjs:49-52`. Real input:
`testRealInputMenu` + `CHECKS.menu` (`scripts/real-input/controls.mjs:14-27`); `hosted-menu` stays a
hand-written row beside `hosted-picker`. Bench arm, story and smoke are G7b.

## 6. Recommendation and questions for the owner

Build it as **Button's sibling carrying Picker's popup engineering**: one host, one model, `group`
as a typed struct array, uncontrolled open state, containment on iOS, `MenuWitness` + one-node
semantics on Android, `intrinsic` sizing on a Button-sized fallback, no handshake.

- **A. Imperative `open()`/`close()`?** Recommend **no** in G7a — it needs the method+hop+commit rule
  (`core.md:226-228`). Alt: test-only `nuiTestOpen`/`nuiTestClose`.
- **B. Android submenus?** Nested menus need a second anchor and a second witness. Recommend: iOS
  submenus, Android flattens them under a divider (one round; precedents: `wheel` on Android,
  `docs/components/picker.md`). Alt: build both, or ship none.
- **C. Nested `group` vs flat `items` + `sectionId`?** Recommend nested `group` (mirrors SwiftUI, and
  a struct array works), with the wrapper normalising.
- **D. iOS-only `primaryAction`** in a two-platform library — ship, or move to 0.5?
- **E. `disabled` while open**: Picker/DatePicker close the window
  (`docs/components/host.md:223`). Adopt that for Menu and gate it — confirm it is the product answer.
