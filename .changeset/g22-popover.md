---
'react-native-nitro-ui': minor
---

New: `Popover`, a platform popover whose content is React Native views.

```tsx
<Popover
  isPresented={open}
  onIsPresentedChange={setOpen}
  anchor={
    <Pressable onPress={() => setOpen(true)}>
      <Text>Share</Text>
    </Pressable>
  }
>
  <Text>Anything React Native can render</Text>
</Popover>
```

- iOS uses UIKit's popover presentation. Android has no popover control, so it uses a Material 3 surface placed below the anchor, above it when there is no room, and clear of the keyboard.
- Content is laid out at up to `maxWidth` (default `320`) and opens at its final size.
- It is controlled: `isPresented` in, `onIsPresentedChange` when the user closes it (a tap outside, or Back on Android), and `onDismiss` once it has gone.
- An open popover does not follow its anchor if the anchor moves.
