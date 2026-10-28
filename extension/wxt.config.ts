import { defineConfig } from 'wxt';
import identity from './identity.json';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'NimDaydu',
    key: identity.publicKey,
    description: '在本机实时转录网页声音，并显示中英双语字幕。',
    minimum_chrome_version: '142',
    permissions: ['activeTab', 'tabCapture', 'offscreen', 'sidePanel', 'storage', 'scripting'],
    host_permissions: ['http://127.0.0.1/*'],
    action: { default_title: 'NimDaydu · 当前标签页字幕' },
    icons: { 16: 'icon16.png', 32: 'icon32.png', 48: 'icon48.png', 128: 'icon128.png' },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+N' }, description: '打开 NimDaydu 字幕侧栏' },
      'toggle-overlay': { suggested_key: { default: 'Alt+Shift+O' }, description: '显示或隐藏网页上的悬浮字幕' },
    },
  },
});

