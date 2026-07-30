import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL ?? 'https://duke-yeah.github.io';
const base = process.env.PUBLIC_BASE_PATH ?? '/MagicChat';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
