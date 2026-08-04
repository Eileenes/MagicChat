import icon from 'astro-icon';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const site = process.env.SITE_URL;
const base = process.env.PUBLIC_BASE_PATH ?? '/';
const harmonyFontDirectory = new URL(
  './node_modules/harmonyos-sans-sc-webfont-splitted/dist/',
  import.meta.url,
);

export default defineConfig({
  site,
  base,
  output: 'static',
  integrations: [
    icon({
      include: {
        tabler: [
          'arrow-down',
          'arrow-right',
          'brand-github-filled',
          'check',
          'file-text',
          'layout-kanban',
          'list-check',
          'message-circle',
          'microphone',
          'paperclip',
          'robot',
          'search',
          'send',
          'shield-check',
          'sparkles',
          'users',
        ],
      },
    }),
  ],
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    resolve: {
      alias: {
        'harmonyos-sans-bold': fileURLToPath(new URL('Bold.css', harmonyFontDirectory)),
        'harmonyos-sans-regular': fileURLToPath(new URL('Regular.css', harmonyFontDirectory)),
        'harmonyos-sans-semibold': fileURLToPath(new URL('Semibold.css', harmonyFontDirectory)),
      },
    },
  },
});
