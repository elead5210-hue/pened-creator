import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'
import path from 'path'

// A dedicated config for Vitest. When vitest.config.ts exists, Vitest uses it
// instead of vite.config.ts, so tests no longer load the app's dev/build-only
// plugins (tanstackStart, nitro and tailwind). Those plugins start file
// watchers and server machinery that can keep the process from exiting after
// a run ("close timed out ... something prevents Vite server from exiting").
// Tests only need the React JSX transform and the '@' path alias, and no test
// reads the generated route tree.
//
// Keep the '@' alias in sync with vite.config.ts and tsconfig.json.

// Set VITEST_HANGING=1 (see the `test:hanging` script) to add Vitest's
// hanging-process reporter, which reports the open handle that keeps the
// process from exiting after a run.
const reporters = process.env.VITEST_HANGING ? ['default', 'hanging-process'] : ['default']

export default defineConfig({
  root: __dirname,
  plugins: [viteReact()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    reporters,
    // Fail fast instead of waiting the default 10s for teardown to time out,
    // and make sure mocks/timers/stubs never leak from one test into the next.
    teardownTimeout: 5000,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})