import { build } from "esbuild";

// Use the existing Vite build tool to run TypeScript without another runtime dependency.
const { outputFiles } = await build({
  entryPoints: ["scripts/ecology.ts"], bundle: true, platform: "node", format: "esm", write: false,
});
await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
