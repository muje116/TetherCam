import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { builtinModules } from 'node:module';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: [
                'electron',
                'cors',
                'express',
                'ffmpeg-static',
                'fluent-ffmpeg',
                'multicast-dns',
                'qrcode',
                'uuid',
                'werift',
                'ws',
                ...builtinModules,
                ...builtinModules.map(m => `node:${m}`)
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
      },
    ]),
    renderer(),
  ],
});
