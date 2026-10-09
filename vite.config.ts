import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = id.split("node_modules/")[1]?.split("/")[0];
          if (!packageName) return undefined;
          if (packageName.startsWith("@hyperjump")) return "vendor-schema";
          if (packageName === "@xyflow" || packageName === "@dagrejs" || packageName?.startsWith("d3-") || packageName === "dagre") {
            return "vendor-graph";
          }
          if (packageName === "xpath" || packageName === "@xmldom") return "vendor-xml";
          if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
            return "vendor-react";
          }
          if (packageName === "yaml") return "vendor-yaml";
          if (packageName === "lucide-react") return "vendor-icons";
          return undefined;
        },
      },
    },
  },
});
