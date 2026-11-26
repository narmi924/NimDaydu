import { defineConfig } from 'wxt';
import identity from './identity.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'NimDaydu',
    key: identity.publicKey,
    default_locale: 'en',
    description: '__MSG_extensionDescription__',
    minimum_chrome_version: '142',
    permissions: ['activeTab', 'tabCapture', 'offscreen', 'sidePanel', 'storage', 'scripting'],
    host_permissions: ['http://127.0.0.1/*'],
    action: { default_title: '__MSG_actionTitle__' },
    icons: { 16: 'icon16.png', 32: 'icon32.png', 48: 'icon48.png', 128: 'icon128.png' },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+N' }, description: '__MSG_openPanel__' },
      'toggle-overlay': { suggested_key: { default: 'Alt+Shift+O' }, description: '__MSG_toggleOverlay__' },
    },
  },
});
