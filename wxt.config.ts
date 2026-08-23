import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Whop Media Saver',
    description: 'Save authorized media from the Whop pages you can access.',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'downloads', 'offscreen', 'storage'],
    host_permissions: [
      'https://whop.com/*',
      'https://*.whop.com/*',
      'https://assets.whop.com/*',
      'https://stream.mux.com/*',
      'https://*.mux.com/*',
    ],
    action: {
      default_title: 'Whop Media Saver',
    },
  },
});
