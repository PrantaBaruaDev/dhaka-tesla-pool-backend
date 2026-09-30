import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/server.ts"],
    format: ["esm"], // Keep this as ESM
    target: "esnext",
    outDir: "dist",
    dts: false,
    clean: true,
    bundle: true,
    splitting: false,
    sourcemap: true,
    
    shims: true,
    // Add this banner to shim require() for CJS dependencies

    banner: {
    js: `
        import { createRequire } from 'module';

        const require = createRequire(import.meta.url);
        `,
    },

});
