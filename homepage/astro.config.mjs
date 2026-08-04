import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL;
const base = process.env.PUBLIC_BASE_PATH ?? '/';

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
    plugins: [tailwindcss()],
  },
});
