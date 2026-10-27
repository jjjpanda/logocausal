import { expect, test } from "@playwright/test";
import { build, createServer, preview } from "vite";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

for (const mode of ["development", "production"]) {
  test(`installed package runs its worker in a Vite ${mode} consumer`, async ({ page }, testInfo) => {
    const root = testInfo.outputPath("consumer");
    const pkg = path.join(root, "node_modules/logocausal");
    mkdirSync(pkg, { recursive: true });
    cpSync("package.json", path.join(pkg, "package.json"));
    cpSync("dist", path.join(pkg, "dist"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "consumer", type: "module", dependencies: { logocausal: "0.1.0" } }));
    writeFileSync(path.join(root, "index.html"), '<!doctype html><html><head><link rel="icon" href="data:,"><script type="module" src="/main.js"></script></head><body><logocausal-network autoplay="false" width="800" height="600"></logocausal-network></body></html>');
    writeFileSync(path.join(root, "main.js"), 'import "logocausal";');
    const options = { configFile: false as const, root, logLevel: "error" as const };
    if (mode === "production") await build({ ...options, base: "./" });
    const server = mode === "development"
      ? await createServer({ ...options, server: { host: "127.0.0.1", port: 0 } })
      : await preview({ ...options, preview: { host: "127.0.0.1", port: 0 } });
    if ("listen" in server) await server.listen();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(server.resolvedUrls!.local[0]);
      const component = page.locator("logocausal-network");
      await expect(component.locator(".graph-node")).toHaveCount(6);
      await expect(component.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
      await expect(component.getByRole("alert")).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await server.close();
    }
  });
}
