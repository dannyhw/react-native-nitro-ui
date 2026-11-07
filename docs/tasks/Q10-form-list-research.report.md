# Q10 — Form, List and Section: how @expo/ui and others do it, and a design for nitro-ui

**Branch:** `task/Q10-form-list-research` (from `main` at `86eb320b`) · **Round:** 1 of 1 (D19, research) ·
**Lease:** none (no device was needed; see Appendix E for why nothing was measured)

## Summary

**How @expo/ui does it** (source at expo/expo `main`, 58.0.23; Appendix A):
- `Form`, `List` and `Section` are SwiftUI's own views, with rows as virtual children of one SwiftUI tree.
- Android has no Form. `FieldGroup` is a `LazyColumn` of `ListItem`s clipped to corner radii Expo picked
  (20/4 dp).
- Plain RN rows need `RNHostView`: a `UIViewRepresentable` with a Yoga size bridge on iOS, and on Android an
  `AndroidView` with about 900 lines of touch workarounds. Android's `LazyColumn` silently drops any other child.
- Since 58.0.6, `List.ForEach` recycles from a JS slot pool (item `i` in slot `i % capacity`). A row is blank
  until JS re-renders its slot.
- Expo's 2026 issues with RN rows: blank rows, 0 × 0 sizes, sizes that arrive late, lost taps.

**Elsewhere** (Appendix B): the old-architecture native list wrappers are dead. Nothing published shows RN rows
in native cells beating FlashList. Nobody ships a native Form that takes RN children.

**Form and Section: GO**, as a native container with RN rows, after a one-round spike (Appendix C1, E):
- **iOS:** a real `UICollectionView` `.insetGrouped` list, the UIKit list under SwiftUI's `Form`. RN rows are
  moved into real cells, and UIKit draws the background, separators, highlight, header and footer.
- **Android:** rows keep their children in place, as ContextMenu's do. M3 Expressive's own `SegmentedListItem`
  shapes (`segmentedShapes(index, count)`, in material3 1.5.0-beta02) draw behind them.
- **Rows:** any RN view, with no wrapper. nitro-ui controls go in unchanged and keep the mount and unmount
  lead they hold over Expo's shared SwiftUI tree (D23, T17).
- **Against @expo/ui:** better on Android fidelity and on DX. Equal on iOS chrome if the spike's pixel check
  holds.
- **Not chosen:** one SwiftUI tree (C2).
- **Effort:** spike S-Form (1 round), G-Form (about 3 rounds), and optionally a `ListItem` leaf (about
  2 rounds).

**List (virtualized): NO-GO with React-rendered rows** (Appendix D):
- React still renders each row, and the native window request adds a native→JS→native hop. So it cannot beat
  FlashList v2 or Legend List on blank area, JS time or memory.
- It would only add features (swipe, reorder, edit mode).
- A data-template list, with no React per row, is the one way to win on performance. It is the owner's call
  (question B).

Nothing was measured (Appendix E): the claims that decide this need the spike's prototype.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1826 tests / 73 suites | `c5390cb8f7a7` | 2 m 53 s | start 6.4 / med 9.4 / max 12.9 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: "review is satisfied on this code tree". The diff touches no platform code, so no device
gate is asked for. The first `check` run in the ledger failed in 5 s because the new worktree had no
`node_modules` (typecheck, lint and format could not start). It passed after `bun install --frozen-lockfile`.

## Red proofs

- None: this is a research task, and no test, gate or runtime code was added.

## Files changed

- `docs/tasks/Q10-form-list-research.report.md` (this report)
- `docs/tasks/Q10/gates.jsonl` (exported ledger) and `docs/tasks/Q10/failures/2026-11-07T11-34-42Z--check--01.log` (the failed first run)

## Follow-ups

- Docs: say in `docs/components/` that nitro-ui controls inside FlashList / Legend List rows are supported, and
  point readers at those lists for long data until a native List exists.
- Bench: a FlashList cell with one nitro-ui Switch per row (recycled RN rows that each hold a hosted control) has
  never been measured. It is the List story we actually ship today.
- Upstream: `expo/expo#52918` (prebuilt ExpoModulesCore without `REACT_NATIVE_TARGET_VERSION`, so size updates
  are asynchronous) affects every @expo/ui baseline we bench against. Check which build the bench app links.

## Questions for orchestrator

**A. Form and Section mechanism.** Options:
- (1) a native container with RN rows: a UIKit list on iOS, M3 segmented rows in place on Android
  (Appendix C1);
- (2) one SwiftUI tree, Expo's model, which needs an iOS "virtual" mode in every nitro-ui control and goes back
  over D23 (C2);
- (3) an RN-drawn look with chrome values read from UIKit and M3 (C3).

**Recommend (1)**, with spike S-Form first (Appendix E). (3) is the fallback if the spike's iOS cell
reparenting fails.

**B. A data-template native List.** Options:
- (1) no native List; document FlashList and Legend List with nitro-ui rows;
- (2) a spike for a `NativeList` whose rows are native templates (title, subtitle, image, accessory, swipe
  actions) fed from a HybridObject data source, with no React per row (D1).

**Recommend (1) now and (2) only on demand.** Form ships first either way.

**C. Row content leaf.** Whether S-Form also prototypes a `ListItem` leaf (UIKit `UIListContentView` /
Compose `ListItem` content: title, subtitle, icon) or leaves rows to RN `Text`. **Recommend: leave it out of the
spike**, and decide it after Form/Section land (it is a plain leaf control under the existing sizing system).

---

## Appendix A — @expo/ui in its source

Read from a shallow clone of `expo/expo` at `45d1285` (main, 2026-11-07; `packages/expo-ui` `package.json`
version 58.0.23, plus `expo-modules-core`'s SwiftUI and Compose view cores). Citations are
`expo:<path-in-expo-repo>:<lines>`. The bench app pins 58.0.22, which already has recycling (58.0.6).

### A1. Components and props

| Layer | Component | Props (beyond `modifiers`) | Source |
| --- | --- | --- | --- |
| swift-ui | `Form` | `children` only | `expo:packages/expo-ui/src/swift-ui/Form/index.tsx`, native `expo:packages/expo-ui/ios/FormView.swift:9-17` (`Form { Children() }`) |
| swift-ui | `List` | `children`, `selection?: (string\|number)[]`, `onSelectionChange` | `expo:packages/expo-ui/src/swift-ui/List/index.tsx:25-41`; native `expo:packages/expo-ui/ios/ListView.swift:11-42` |
| swift-ui | `List.ForEach` | `data`, `keyExtractor`, `children: ({item,index}) => element`, `recycling = true`, `overscanCount = 10`, `estimatedItemSize = 64`, `onDelete`, `onMove` | `expo:packages/expo-ui/src/swift-ui/List/DataListForEach.tsx:13-50` |
| swift-ui | `Section` | `title?`, `header?: ReactNode`, `footer?: ReactNode`, `isExpanded?` / `onIsExpandedChange` (iOS 17, sidebar style) | `expo:packages/expo-ui/src/swift-ui/Section/index.tsx:7-38`; header/footer are named slots, `:63-65` |
| jetpack-compose | `LazyColumn` | `verticalArrangement`, `horizontalAlignment`, `contentPadding` | `expo:packages/expo-ui/src/jetpack-compose/LazyColumn/index.tsx:31-59` |
| jetpack-compose | `LazyColumn.Items` / `LazyItems` | same `data`/`keyExtractor`/recycling props as `List.ForEach` | `expo:packages/expo-ui/android/src/main/java/expo/modules/ui/LazyItemsView.kt:50-56` |
| jetpack-compose | `ListItem` | `colors`, `tonalElevation`, `shadowElevation`, slot children (headline, supporting, leading, trailing) | `expo:packages/expo-ui/src/jetpack-compose/ListItem/index.tsx:10-46` |
| universal | `FieldGroup`, `FieldGroup.Section` | `title?`, `titleUppercase?`, header/footer slot children | `expo:packages/expo-ui/src/universal/FieldGroup/types.ts:29-65` |
| universal | `List`, `List.ForEach`, `ListItem` | `onRefresh` (Android wraps `PullToRefreshBox`) | `expo:packages/expo-ui/src/universal/List/index.android.tsx` |

- The universal `FieldGroup` is SwiftUI `Form` on iOS (`expo:packages/expo-ui/src/universal/FieldGroup/FieldGroup.ios.tsx:27`)
  and a `LazyColumn` with 24 dp spacing and 16 dp padding on Android
  (`expo:packages/expo-ui/src/universal/FieldGroup/FieldGroup.android.tsx:39-45`).
- An Android section is a Compose `Column` of `ListItem`s, each clipped to a rounded shape that depends on its
  position. The radii are Expo's own constants: 20 dp at the ends, 4 dp between rows, and a 2 dp gap
  (`expo:packages/expo-ui/src/universal/FieldGroup/FieldSection.android.tsx:78-110,130-144`). It does **not**
  use M3's `SegmentedListItem`, which material3 1.5.0-beta02 ships (`ListItemDefaults.segmentedShapes(index,
  count)`, `segmentedColors`, `SegmentedGap`, checked with `javap` against the AAR in this machine's Gradle
  cache).

### A2. How rows are supplied

- **iOS: any child becomes a SwiftUI child.** A Fabric child that is an `ExpoSwiftUI.View` is used as it is.
  Anything else, a plain RN view included, is wrapped in `UIViewHost`, which is a `UIViewRepresentable`
  (`expo:packages/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift:367-378`).
  - `UIViewHost` hands SwiftUI a disposable `ReactViewIsolationContainer`, because "SwiftUI mutates the view
    it hosts … corrupting unmounted or recycled React views". Expo hit that in `expo/expo#47706`
    (`expo:packages/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIViewHost.swift:65-107`).
  - Without `RNHostView` the RN view has no size SwiftUI can read. The docs say to wrap RN content in
    `RNHostView` and to pass it a single child (`docs/pages/versions/unversioned/sdk/ui/swift-ui/rnhostview.mdx:19`
    in the expo repo). The universal `ListItem` wraps every accessory in `RNHostView matchContents`
    (`expo:packages/expo-ui/src/universal/ListItem/ListItem.ios.tsx:26-34`).
- **iOS `RNHostView` sizing is a round trip.** With `matchContents`, Yoga sizes the content and SwiftUI takes
  the frame from the Yoga node. Without it, SwiftUI's proposed size is pushed into Yoga through
  `shadowNodeProxy.setViewSize`
  (`expo:packages/expo-ui/ios/RNHostView.swift:192-200,276-290,309-341`). That is the same shape as our
  BottomSheet's `onContentBox` round trip.
- **Android: only Compose children count.** `LazyColumn` loops over its children and `continue`s past
  anything that is not an `ExpoComposeView`
  (`expo:packages/expo-ui/android/src/main/java/expo/modules/ui/LazyColumnView.kt:83-96`), so a plain RN row
  is dropped unless it is wrapped in `RNHostView`. `RNHostView` is an `AndroidView` with a custom
  `TouchDispatchingRootViewGroup` (JS touch dispatch copied from RN's `DialogRootViewGroup`, plus
  `NestedScrollingChild3`). It is 907 lines and carries named workarounds for `expo/expo#46386` (stale bounds
  swallowing presses) and `expo/expo#51159` (a ripple container taking the touch target)
  (`expo:packages/expo-ui/android/src/main/java/expo/modules/ui/RNHostView.kt:220-222,390-431`).

### A3. Virtualization and recycling

- **SwiftUI `List` and `Form` are lazy.** Plain children render as SwiftUI rows, and SwiftUI only builds
  the rows it displays. Every row is still a mounted React and Fabric node.
- **`List.ForEach` with `data` recycles by default** (58.0.6, `expo/expo#49975`, iOS; `LazyColumn.Items`
  58.0.6, `expo/expo#50258`, Android; universal `List.ForEach` 58.0.23, `expo/expo#52047`):
  - **JS** keeps a pool whose capacity is the visible range plus `overscanCount` on each side. Item `index`
    always renders in slot `index % capacity`, so a move re-renders only the slots whose item changed, and the
    pool never shrinks (`expo:packages/expo-ui/src/recycling/useRecycledRows.tsx:84-88,151-168`;
    `expo:packages/expo-ui/src/recycling/window.ts:13-19`).
  - **Native** builds a `ForEach` over *all* item keys. Each row reads its slot from the pool
    (`slots[index % slots.count]`) and shows the content only when the slot's `itemKey`, `index` and
    `revision` match. Otherwise it shows a `Color.clear` placeholder at the measured or estimated height
    (`expo:packages/expo-ui/ios/DataListForEachView.swift:92-108,120-127,178-216`).
  - **Window requests** are batched with one `DispatchQueue.main.async` hop, then sent as `onWindowChange`
    to JS, which re-renders the slots (`expo:packages/expo-ui/ios/DataListForEachView.swift:290-310`).
    Android does the same with `items(count, key)` and a `Spacer` placeholder
    (`expo:packages/expo-ui/android/src/main/java/expo/modules/ui/LazyItemsView.kt:138-208`).
  - **Rows keep their state.** A recycled row keeps its `useState` from the item it showed before, and
    `renderItem` must be stable (`expo:packages/expo-ui/src/swift-ui/List/DataListForEach.tsx:25-31`).
  - **Element children are deprecated** (`expo:packages/expo-ui/src/swift-ui/List/ListForEach.tsx:53-78`).

So Expo's "recycling" is FlashList's idea moved under a SwiftUI or Compose list. React still renders each row.
The native list owns scrolling, separators, swipe-to-delete and reorder.

### A4. Sizing, performance, limits (docs and issues)

- **Docs** (`expo` repo, `docs/pages/versions/unversioned/sdk/ui/`):
  - SwiftUI controls the frame of hosted UIKit views. "Once you render React Native components, you're
    leaving the SwiftUI context." "Keep SwiftUI layouts self-contained" (`index.mdx`, FAQ).
  - The List rules: stable `children`, carried-over state, a placeholder until a row is ready, set
    `estimatedItemSize`, and replace `data` rather than mutating it (`swift-ui/list.mdx:140-150`).
  - There are no published numbers for List or Form performance.
- **Issues, all 2026:**
  - `expo/expo#52214`: an `RNHostView` in a SwiftUI `List` row renders 0 × 0 (closed 10-25).
  - `expo/expo#52692`: `RNHostView` rows go blank after scrolling. SwiftUI makes several representable
    instances and the RN view ends up in a container that is off screen (closed 11-04).
  - `expo/expo#52918` (open): the prebuilt ExpoModulesCore is compiled without `REACT_NATIVE_TARGET_VERSION`,
    so SwiftUI size updates use `UpdateMode::Asynchronous`.
  - `expo/expo#51681`: `moveDisabled` and `deleteDisabled` were ignored with the recycled `List.ForEach`.
  - `expo/expo#52410`: a universal `Column` with no size lays out at width 0, so a `List` inside renders
    nothing.
  - `expo/expo#49540` and `#50086`: FieldGroup put a `ListItem` inside a second `ListItem` on Android.
  - `expo/expo#46865`: FieldGroup and conditional children on Android.
  - `expo/expo#52196`: Android `RNHostView` eats taps meant for a parent `clickable`.
  - The 58.0.x changelog carries about a dozen more `RNHostView` fixes (touch, `measure()`, remount,
    animated resize).

---

## Appendix B — Survey of other solutions

- **Downloads:** npm last-week counts (2026-10-31 to 11-06), fetched 2026-11-07 from `api.npmjs.org`.
- **Maintenance:** the date is the last push or release.
- **Issue numbers** are each project's own GitHub issues.
- **Verification:** the Expo PRs, `react-native-list` and the FlashList and Legend List counts were re-checked
  by hand. The rest come from a survey pass reading READMEs, source and issues.

| Library | Kind | Maintenance | Weekly dl | Mechanism | What goes wrong |
| --- | --- | --- | --- | --- | --- |
| `react-native-tableview` (aksonov) | UITableView, iOS | dead (release 2021-01) | 170 | data or `<Item>` rows as real cells; `reactModuleForCell` makes each cell its own RN root; no Fabric | #218 maintainer gone; #211 cell height won't resize; #223 `flex:1` no height |
| `react-native-recyclerview-list` | RecyclerView, Android | archived (2018) | 38 | RN item views in RecyclerView, old arch | old arch only |
| `react-native-ios-list-view` (dominicstop) | UITableView, RN cells | stalled 2024 ("rewrite WIP") | — | reused cells keep RN state across rows; self-sizing; reorder | not on Fabric |
| `react-native-list` (hannojg) | UICollectionView / RecyclerView, RN cells | alive (2.0.2, 2026-10-17) | 50 | renders rows on the UI thread through worklets; private Fabric mounting APIs; validated on RN 0.86.2 only | own bench vs Legend List: same FPS and memory, CPU 185.9% vs 144.7%, never blank but drops UI frames on heavy rows |
| Margelo WishList | C++ shadow-node templates | prototype, abandoned | — | per-type templates bound natively | Expo's blog: stopped because the API was too hard to use |
| `@expo/ui` List / LazyColumn | SwiftUI List / Compose LazyColumn | very active | 7.0M (mostly transitive, unverified) | Appendix A; slot-recycled React rows since 58.0.6 | Appendix A4; PR #49975: "some blanks on ultra fast scrolls"; PR #46767 had documented "not truly lazy, use FlashList/Legend List" before recycling |
| `mgcrea/react-native-swiftui` | one SwiftUI tree, iOS | alive (0.19.0, 2026-09) | 33 | JSX returns null; a descriptor tree serialized to **JSON** drives one `UIHostingController`; real `Form`/`Section` | **cannot host RN views** in a Form; JSON props (ruled out by our perf contract) |
| `react-native-bottom-tabs` (Callstack) | SwiftUI TabView, RN children | active (1.5.0, 2026-10) | 142k | Fabric `mountChildComponentView` inserts each child, wrapped in a `UIViewRepresentable` container; SwiftUI geometry sent to JS, which sets each child's width and height (our BottomSheet's round trip); opts out of Fabric recycling | #555 stuck startup height; #276 presses lost (36 comments); #557 no resize when the bar hides |
| `react-native-ios-context-menu` / `-ios-utilities` | RN views detached into UIKit | slow (2025-09) | 243k / 239k | wrapper views moved into non-React parents | #94 `viewNotFoundForReactTag`; #100 new arch still open |
| `react-native-tableview-simple` | JS iOS grouped look | slow (2024-06) | 1.75k | plain Views, no virtualization | #782 hairlines at fractional scale; #847 deprecated SafeAreaView |
| `react-native-paper` `List.Section`/`List.Item` | JS, MD3 | active (5.15.4) | 641k | plain Views; you add FlatList | #4976/#5164 not on the current MD3 list spec; #4946 colors recomputed per render |
| Tamagui `ListItem`/`YGroup` | JS (compiled styles) | active (3.2.3) | 292k | styled Views | #2776 slow inside FlashList |
| `@rneui/themed` `ListItem` | JS | slow (5.0.0, 2026-01) | 60k | plain Views | #3943 Fragment children break layout |
| `react-native-settings-list`, `-settings-components` | JS | dead (2017/18) | 2.4k / 21 | plain Views | — |
| FlatList / SectionList | JS virtualizer (core) | core | — | windowed mount and unmount, no recycling | RN #48258 SectionList renders all; #59731 Fabric inverted list blank on iOS 27 |
| `@shopify/flash-list` v2 | JS recycler | active (2.3.3, 2026-10) | 3.47M | new arch only, no native code, no size estimates; synchronous measure and correction in a layout effect; velocity-adaptive window; per-type pools | #1773 render loop; #1797 overlap; #1784 blanks after `scrollTo` mid-fling |
| `@legendapp/list` | JS virtualizer | very active (3.7.2, 2026-11-07) | 1.72M | pure TS, opt-in `recycleItems`, dynamic sizes, JS maintain-visible-position | #565 permanent blank after fast scroll on iOS Fabric; #325 nested recycling blanks |
| `recyclerlistview` (Flipkart) | JS recycler | stale (2025-03) | 912k (FlashList v1 dependency) | explicit sizes, view-type pools | #611/#716 white screen on fast scroll |

**What the survey says for this design.**
- **Fabric support:** every old-architecture native list wrapper is dead or not on Fabric. The two live
  native-cell designs are Expo's (A3) and `react-native-list`, which relies on private Fabric APIs and still
  costs more CPU than Legend List in its own benchmark.
- **No benchmark** shows a native-recycled list with RN rows beating FlashList.
- **RN children in native containers work** when the container owns the reparenting and pushes the size back
  through Yoga (bottom-tabs; our BottomSheet and ContextMenu). They break when SwiftUI's representable layer
  sits in between (Expo's 2026 List bugs).
- **JS form looks** have the users (Paper, Tamagui, RNEUI) and drift from the platform spec. No one ships a
  native Form for RN children.

---

## Appendix C — Design: Form and Section

### C1. Recommended: a native container with React Native rows

```tsx
import { Form, Section, Switch, Picker } from 'react-native-nitro-ui';

<Form style={{ flex: 1 }}>
  <Section title="Connectivity" footer="Airplane mode turns off all radios.">
    <View style={styles.row}>          {/* a bare child is one row */}
      <Text>Airplane mode</Text>
      <Switch value={on} onValueChange={setOn} />
    </View>
    <Form.Row onPress={openWifi} accessory="disclosure">
      <MyWifiRow ssid={ssid} />        {/* any React Native view */}
    </Form.Row>
  </Section>
</Form>
```

- **API.**
  - **`Form`** is the scroll container. `style` covers layout only; the background is the platform's grouped
    background.
  - **`Section`**: `title?: string`, `footer?: string`. RN header and footer nodes come later. Every direct
    child is one row.
  - **`Form.Row`** is optional and holds the cell-level behaviour: `onPress` (cell highlight and selection;
    a ripple and the shape's pressed state on Android), `accessory: 'none' | 'disclosure' | 'checkmark'`
    (`UICellAccessory` on iOS; a trailing M3 icon on Android) and `selected`.
  - A bare child is wrapped in a `Form.Row` by `Section`'s JS.
  - Hybrid View props follow the perf contract: `T | null`, every prop passed, stable callbacks.
- **iOS mechanism.**
  - **The list:** `NitroUiForm` owns a `UICollectionView` with `UICollectionLayoutListConfiguration(appearance:
    .insetGrouped)` and supplementary header and footer modes, configured with
    `UIListContentConfiguration.groupedHeader()` / `.groupedFooter()`.
  - **Mounting:** a `.mm` mount patch, BottomSheet's `CONTENT_CHILDREN_VIEWS` mechanism in
    `scripts/patch-nitrogen.mjs` extended by one class, routes Section and Row component views into a model
    instead of the view tree.
  - **Rows in cells:** `cellForItemAt` moves the row's component view into the cell's `contentView`, inside a
    small container pinned to `layoutMarginsGuide` that cancels the row's Yoga origin. Leading content then
    lines up with the separator inset and the header text, as a system cell's does.
  - **Cell reuse:** `prepareForReuse` takes the row back out. A row is never in two cells, because we own
    `cellForItemAt`. SwiftUI's several representable instances are what cause `expo/expo#52692`, and that
    layer is not here.
  - **What UIKit draws:** the background, separators, selection highlight, accessories and the a11y
    container.
- **Android mechanism.**
  - **The scroll container:** `Form` is a vertical scroll container on the theme's `surfaceContainer`-family
    background (decided by the spike). `Section` is JS: a header in M3 typography, then rows spaced by
    `ListItemDefaults.SegmentedGap`.
  - **Rows in place:** `Form.Row` is a native view that keeps its children in place, with a hand-written
    `ReactViewManager` subclass exactly as ContextMenu has (`NitroUiContextMenuViewManager.kt`, D37). Behind
    the RN children sits a Compose layer drawing a `SegmentedListItem` container with
    `ListItemDefaults.segmentedShapes(index, count)` and `segmentedColors()`. `index` and `count` come from
    `Section`'s JS.
  - **Press feedback:** touches go to the RN children first. The press feedback of a row with `onPress`
    comes from the wrapper watching touches without taking them (ContextMenu's long-press path) and feeding a
    `PressInteraction` to the Compose layer.
- **Sizing.**
  - **No intrinsic size:** Rows have `sizing: null`. Yoga lays out the RN children, as in ContextMenu.
  - **iOS width:** a Form reports its cell content width (the list's width minus section insets and cell
    margins) through state, the same `onContentBox` round trip as BottomSheet. Rows lay out at that width.
    The first frame uses a phone-correct guess.
  - **iOS height:** each row's Yoga height drives the cell's preferred height. A change in a row's layout
    metrics invalidates that one item.
  - **Android:** nothing is reported. The row is its Yoga box.
- **Accessibility.**
  - **Rows:** a row with `onPress` is one element with the button trait and role (iOS: the cell; Android:
    a merged clickable node). A row without one leaves its children as they are, so a hosted Switch keeps its
    own element.
  - **Headers:** section headers get the header trait (UIKit gives it) or a `heading()` semantic (Android).
  - **Verification:** by automation only (D37.4).
- **Recycling.** Form, Row and the iOS Section model implement `RecyclableView` with a full reset. UIKit's
  cell reuse is internal and does not touch Fabric's recycling of the row views.
- **Cost model.**
  - Rows mount as ordinary Fabric views, so a 40-row settings screen mounts 40 RN rows (as any RN screen
    would). iOS displays cells only for visible rows, plus prefetch.
  - nitro-ui controls in rows stay standalone, the path where T17 measured us at 0.67x of Expo's shared
    tree on mount UI CPU and 0.16x on unmount (Switch).
  - The open risk is memory and `mounted` against Expo's lazy SwiftUI `Form` at N ≥ 50 (T17: 4.39x
    `mounted`). The spike measures it.
- **What it does not get** compared with a SwiftUI `Form`: SwiftUI-only row behaviours (a `Picker` that
  restyles itself into a navigation row, `LabeledContent`, collapsible sidebar sections). Swipe actions are a
  natural follow-up (`UISwipeActionsConfiguration`), not v1.
- **Effort.**
  - S-Form: 1 task, 1 round, a prototype that is never merged (D19 spike rule).
  - G-Form (Form, Section, Row on both platforms, harness, README rows and screenshots, benches): 1 task,
    about 3 rounds. It is BottomSheet-class: a `.mm` patch, a hand-written view manager and a state round
    trip.
  - An optional `ListItem` content leaf: 1 task, about 2 rounds.

### C2. Rejected for v1: one SwiftUI tree (Expo's model)

- **What it would take:** every nitro-ui control would need an iOS "virtual" mode, rendering its SwiftUI
  content into the Form's tree instead of its own `UIHostingController`. That is the shared iOS tree D23
  measured and rejected (mount UI CPU 1.40x, unmount 6.27x on Switch, T17). It is the mechanism, not the
  container, so D23's "revisit only with a new mechanism" applies.
- **RN rows would need Expo's `RNHostView` machinery** (Appendix A2) and would inherit its class of bugs
  (Appendix A4).
- **Android has no Form to share it with**, so the second platform is C1's work anyway.
- **What it would buy:** SwiftUI's row behaviours and laziness for SwiftUI-rendered rows. The first is a
  feature list, not a reason. The second only matters past about 50 rows, where a List belongs.

### C3. Fallback: RN layout with chrome read from the platform

- **How it works:** `Section` would be an in-place container that draws the inset-grouped background and
  separators itself, using values read at runtime from `UIBackgroundConfiguration` and
  `UIListContentConfiguration` (iOS) and from M3 tokens (Android). It is cheapest and keeps measure() and
  keyboard behaviour exactly RN's.
- **The cost on iOS:** some of the inset-grouped look lives in the collection view's layout (section corner
  rounding, margins on iPad and in landscape, iOS 26's geometry), not in a public configuration. Matching
  it means typing constants, which is drawing an imitation (D38.1). Use C3 only if the spike's cell
  reparenting fails. On Android, C1 and C3 converge, since there is no platform Form.

---

## Appendix D — Design: List (virtualized)

**Can a native List beat FlashList or Legend List?** Compare where the time goes when a fast fling reaches
rows that are not rendered yet:

| Step | FlashList v2 / Legend List | Native list with React rows (Expo's model, or ours) |
| --- | --- | --- |
| Native learns rows are needed | scroll event to JS (RN's ScrollView) | cell or row appears (native) |
| Request reaches React | already in JS | `onWindowChange` hop: native, then JS, then a state update |
| Row content | React re-renders a recycled component | React re-renders a slot (the same work) |
| Commit | Fabric commit; v2 measures synchronously in a layout effect | Fabric commit, then the native list updates the slot (SwiftUI or Compose recomposition) |
| Until then | blank area | a placeholder at the estimated height, which is also blank area |

The React work is identical. The native list adds a hop and a second layout system. It cannot win on blank
area, JS-thread time or memory for React rows; at best it ties. The evidence agrees:
- Expo's own recycling PR reports "some blanks on ultra fast scrolls" (`expo/expo#49975`) and publishes no
  numbers.
- `react-native-list` avoids the hop by rendering on the UI thread. It ties Legend List on FPS and memory and
  costs about 41 points more total CPU (Appendix B).
- No published benchmark shows a native-recycled list with RN rows beating FlashList. What it does win, and only through
native-specific code, is:
- native swipe actions;
- drag reorder;
- edit-mode multi-select;
- section index;
- the a11y "row n of N" semantics;
- platform separators.

Those are features, and the Form's `UICollectionView` (C1) is the natural place to add swipe actions to short
lists later.

**How cell reuse would work with React rows, if it were built anyway.**
- Expo's scheme is the only coherent one: a JS slot pool keyed `index % capacity`, native keys for the whole
  data set, and a placeholder when the slot does not carry the row's key and revision (Appendix A3).
- A nitro-ui version would move the window request and the slot props onto a HybridObject callback. Under the
  perf contract that means no JSON and no inline callbacks.
- It would still pay the JS round trip, so the same blank-area result.

**Where a native List could win: native row templates, no React per row.**
- A `NativeList` whose rows are typed records (title, subtitle, image URI, accessory, swipe actions) held in a
  HybridObject data source with diff operations, rendered by `UIListContentConfiguration` cells and Compose
  `ListItem`s (core-architecture §6, "large data-driven lists").
- No JS runs per row, so blank area is bounded by native cell configuration. It could beat FlashList on fast
  flings and the JS thread at 10k rows.
- The cost is that rows are not React: no custom row layout beyond the template.
- Spike go criteria: blank area at three fling speeds and JS-thread time at 10k rows, on both platforms, each
  at or below FlashList v2 in the same run, with swipe actions working.
- Effort: a spike (1 round), then about 2 G tasks.

**Verdict: no-go on a React-row native List. Defer the template list to the owner (question B).**

---

## Appendix E — Spike S-Form, and why nothing was measured here

**Why no measurement in this task.** The brief's example measures mount cost of N rows in an @expo/ui `Form`
against RN rows in a native grouped container, and that container does not exist yet. Building one, even
throwaway, means:
- the iOS cell-reparenting mount patch;
- the width round trip;
- a bench arm in the registry-driven bench app;
- release builds on both platforms.

That is the spike itself, not an hour. The Expo side alone measures nothing that decides the design. A
cheaper proxy, Expo's Form against a plain RN `View` column, would compare against a container we would not
ship.

**S-Form: one task, one round, both platforms, the prototype is never merged.** Questions and go criteria:

1. **Reparenting.** Fabric children of an iOS `NitroUiForm` moved into `UICollectionViewListCell`s mount,
   update, reorder (a keyed insert in the middle) and unmount without Fabric assertions. Over 50
   scroll-through cycles the leak probe shows no leftover row views. *Go:* 10/10 on the harness.
2. **Fidelity.** On iOS 27 (and iOS 26 if a runtime is installable), a 3-section form (text rows, a Switch
   row, a disclosure row, header and footer) is compared with the same form in SwiftUI `Form`: light, dark and
   the largest Dynamic Type size. *Go:* row heights, section insets and corner radius within 1 pt, and
   separator and header positions within 1 pt. On Android, `SegmentedListItem` shapes follow `index`/`count`
   when rows are inserted and removed.
3. **Sizing.** A row whose RN text wraps at the cell width has the right height on its first frame on a phone,
   and is corrected within one frame on iPad and in landscape. A row's height change animates its cell.
4. **Touch and measure.** Taps on a nitro-ui Switch and an RN `Pressable` in a row land (real input). Report
   whether `measure()` / `measureInWindow` of a row is right after scrolling. *Go:* taps 10/10. `measure`
   either right or documented, with a plan.
5. **Keyboard.** A TextField row near the bottom stays visible when focused (UICollectionView does not avoid
   the keyboard on its own). *Go:* visible on both platforms.
6. **Cost.** Mount N = 20/50 mixed rows (bench, `quick` plan, against `@expo/ui` `Form` and
   `FieldGroup`). *Go:* mount UI CPU at or below Expo, and memory and `presented` within 1.2x at N = 50.
   A miss on memory alone is a documented trade, not a no-go.
7. **Android press.** A row with `onPress` shows M3's pressed state without stealing touches from a Switch
   inside it. *Go:* both behaviours 10/10 with real input.

GO means 1, 2, 3, 4 (taps) and 7 pass. Then G-Form is briefed with the spike's answers to 4 (measure), 5 and 6.
