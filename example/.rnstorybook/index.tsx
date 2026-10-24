// The Storybook entry point. Metro's `withStorybook` wrapper resolves the app
// entry (`example/index.js`) here when `STORYBOOK_ENABLED=true`, so nothing in
// the app itself has to know Storybook exists.
//
// Because it *replaces* the app entry, it has to do what an entry does: register
// a root component rather than only export one. It registers under the app's own
// name, so the unchanged native side (which asks for `NitroUiExample`) starts
// Storybook instead of the example app.
//
// No `storage` is passed: the default `getStorybookUI` storage is in-memory,
// and the example app carries no AsyncStorage dependency, so the last-selected
// story is simply not persisted across launches.
import { AppRegistry } from 'react-native';

import { name as appName } from '../app.json';
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: false,
});

AppRegistry.registerComponent(appName, () => StorybookUIRoot);

export default StorybookUIRoot;
