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
          'arrow-left',
          'arrow-right',
          'brain',
          'brand-github-filled',
          'checkbox',
          'check',
          'download',
          'device-mobile',
          'edit',
          'eye',
          'file-text',
          'layout-kanban',
          'list-check',
          'message-circle',
          'microphone',
          'paperclip',
          'pointer-2',
          'plug-connected',
          'robot',
          'search',
          'send',
          'shield-check',
          'sparkles',
          'users',
          'x',
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
