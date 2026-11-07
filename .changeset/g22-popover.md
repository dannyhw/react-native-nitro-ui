---
'react-native-nitro-ui': minor
---

Add `Popover`: a platform popover whose content is React Native views.

```tsx
<Popover
  isPresented={open}
  onIsPresentedChange={setOpen}
  anchor={<Text>Share</Text>}
>
  <Text>Anything React Native can render</Text>
</Popover>
```

- **iOS** is a `UIPopoverPresentationController`, presented from a window of its own as `Tooltip` is, so closing a React Native `Modal` cannot take the popover down with it or leave the `Modal`'s host over the app. **Android** has no popover control, so it is a Compose `Popup` under a Material 3 `Surface`, with this library's own position provider: below the anchor and start-aligned, above it when there is no room below, and moved clear of the keyboard.
- **The content lays itself out before the popover shows it.** The wrapper renders your children in the app's own tree at up to `maxWidth` (default `320`, and never more than the window less 32), and native reads that box rather than measuring anything — so the popover's first frame is already its final size on both platforms.
- **Controlled, like every other control here**: `isPresented` in, `onIsPresentedChange` back when the user closes it (a tap outside, or Back on Android), and `onDismiss` when it has gone. `onIsPresentedChange` is not called for a change the app made itself, and a close the app refuses presents the popover again.
