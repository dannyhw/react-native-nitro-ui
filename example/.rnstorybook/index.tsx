// The Storybook entry point. Metro resolves the app entry here when
// `STORYBOOK_ENABLED=true`, so it registers its root under the app's own name.
import { AppRegistry } from 'react-native';

import { name as appName } from '../app.json';
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  shouldPersistSelection: false,
});

AppRegistry.registerComponent(appName, () => StorybookUIRoot);

export default StorybookUIRoot;
