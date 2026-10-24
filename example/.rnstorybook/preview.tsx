// Global Storybook preview: the controls/actions parameters the on-device
// addons read, plus the background swatches the Backgrounds panel offers
// (light / dark / surface). The default swatch follows the device appearance so
// the controls are seen against a matching surface when a story first opens.
import { withBackgrounds } from '@storybook/addon-ondevice-backgrounds';
import { Appearance } from 'react-native';

import type { Preview } from '@storybook/react-native';

const preview: Preview = {
  decorators: [withBackgrounds],
  parameters: {
    actions: {
      argTypesRegex: '^on[A-Z].*',
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#000000' },
        { name: 'surface', value: '#1c1c1e' },
      ],
    },
    layout: 'padded',
  },
};

export default preview;
