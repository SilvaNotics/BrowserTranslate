import { defineConfig } from 'wxt';
import { version } from './package.json';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '译境 · BrowserTranslate',
    version,
    minimum_chrome_version: '124',
    description: '使用自己的模型，划词、整页和截图翻译。内置 Exa 联网词典解释。',
    permissions: ['storage', 'activeTab', 'offscreen'],
    options_ui: { open_in_tab: true },
    host_permissions: ['<all_urls>'],
    commands: {
      'capture-region': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: '框选截图翻译',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    icons: { 16: '/icons/16.png', 32: '/icons/32.png', 48: '/icons/48.png', 128: '/icons/128.png' },
  },
});
