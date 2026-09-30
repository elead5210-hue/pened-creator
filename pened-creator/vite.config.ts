import { defineConfig } from "vitest/config";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import path from "path";

export default defineConfig({
  root: __dirname,
  plugins: [
    tailwindcss(),
    tanstackStart({
      tsr: {
        srcDirectory: "src",
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      },
    }),
    // Makes `vite build` also emit a self-contained Node server at
    // .output/server/index.mjs (nitro's default node-server preset), which is
    // what `npm start` and the Dockerfile run. Without it the build only
    // produces dist/client and dist/server/server.js, which isn't runnable
    // on its own. It reads PORT (and HOST) from the environment at runtime.
    nitro(),
    viteReact(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Binding to all interfaces (rather than the default localhost-only)
    // so the dev server is reachable over the LAN, e.g. http://192.168.1.97:5174.
    host: true,
    // Fixed port: fail loudly if 3000 is taken instead of silently moving to
    // 3001, which would invalidate the documented LAN URLs.
    port: 3000,
    strictPort: true,
    fs: {
      allow: [__dirname],
    },
    // Deliberately no explicit hmr.host/port here. Pinning those to one
    // specific LAN IP/port broke the HMR WebSocket handshake (426 Upgrade
    // Required) for any browser that loaded the page from a different
    // address than the pin - which is exactly what happens on a LAN with
    // multiple reachable interfaces/ports. Leaving hmr unset lets Vite's
    // client derive the WS target from window.location, so it matches
    // whatever host/port the page was actually served from, whether
    // that's localhost or a LAN IP.
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // scripts/**/*.test.js covers the build guards (e.g. check-api-calls.js),
    // which are plain Node ESM files rather than part of src/.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.js"],
    css: false,
  },
});
