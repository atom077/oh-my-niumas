import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/echarts/") ||
            id.includes("/node_modules/zrender/")
          )
            return "charts";
        },
      },
    },
  },
  server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" } },
});
