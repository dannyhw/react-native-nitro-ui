// The Storybook entry point. Metro's `withStorybook` wrapper resolves the app
// entry (`example/index.js`) here when `STORYBOOK_ENABLED=true`, so nothing in
// the app itself has to know Storybook exists.
//
// No `storage` is passed: the default `getStorybookUI` storage is in-memory,
// and the example app carries no AsyncStorage dependency, so the last-selected
// story is simply not persisted across launches.
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: false,
});

export default StorybookUIRoot;
