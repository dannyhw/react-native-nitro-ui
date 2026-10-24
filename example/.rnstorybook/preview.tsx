// Global Storybook preview: the controls/actions parameters the on-device
// addons read, plus the background swatches the built-in backgrounds panel
// offers (light / dark / surface), defaulting to whichever appearance the
// device is in so the controls are seen against a matching surface.
import { Appearance } from 'react-native';

import type { Preview } from '@storybook/react-native';

const preview: Preview = {
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
      options: {
        light: { name: 'Light', value: '#ffffff' },
        dark: { name: 'Dark', value: '#000000' },
        surface: { name: 'Surface', value: '#1c1c1e' },
      },
    },
    layout: 'padded',
  },
  initialGlobals: {
    backgrounds: {
      value: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
    },
  },
};

export default preview;
