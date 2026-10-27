import { expect, test } from "@playwright/test";
import { DRAFT_KEY } from "../src/draft";

const site = "http://127.0.0.1:4174/logocausal/";

test("regular view loads its favicon and analysis worker under the Pages path", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(site);
  await expect(page.locator(".graph-node")).toHaveCount(6);
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
  const favicon = await page.locator('link[rel="icon"]').evaluate((link: HTMLLinkElement) => link.href);
  expect(favicon).toBe(`${site}favicon.svg`);
  expect((await page.request.get(favicon)).ok()).toBe(true);
  expect(page.workers()).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const size of [{ width: 800, height: 450 }, { width: 320, height: 240 }]) {
  test(`hosted embed fills ${size.width} × ${size.height} without panels or saved state`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(key => localStorage.setItem(key, "saved workbench"), DRAFT_KEY);
    await page.goto(`${site}embed/?autoplay=false&theme=light&transparent=true&speed=12&embed=false`);
    await expect(page.locator(".graph-node")).toHaveCount(6);
    await expect(page.locator(".app-header, .side, .habitat-heading")).toHaveCount(0);
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "light");
    expect(await page.locator(".network-svg").boundingBox()).toEqual({ x: 0, y: 0, ...size });
    expect(await page.locator("html").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    const sun = page.locator(".sun");
    const before = await sun.getAttribute("transform");
    await page.locator(".app-shell").focus();
    await page.keyboard.press("s");
    await expect(sun).not.toHaveAttribute("transform", before!);
    expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBe("saved workbench");
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(size);
  });
}

test("full iframe keeps controls and runs its analysis worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(site);
  await page.evaluate(src => {
    const iframe = document.createElement("iframe");
    iframe.title = "Full Logocausal";
    iframe.src = src;
    iframe.style.cssText = "position:fixed;inset:0;width:800px;height:600px;border:0;z-index:10";
    document.body.append(iframe);
  }, `${site}?autoplay=false&theme=light&speed=5`);
  const frame = page.frameLocator('iframe[title="Full Logocausal"]');
  await expect(frame.getByRole("button", { name: /Play/ })).toBeVisible();
  await expect(frame.locator(".graph-node")).toHaveCount(6);
  await expect(frame.getByRole("tab", { name: "Guide", exact: true })).toBeVisible();
  await expect(frame.locator(".slider b")).toHaveText("5/s");
  await frame.getByRole("button", { name: "Step", exact: true }).click();
  await expect(frame.locator(".hud")).toContainText("T0001");
  await expect(frame.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
  expect(errors).toEqual([]);
});

test("cross-origin iframe runs when local storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  });
  await page.goto("http://127.0.0.1:4173/");
  await page.evaluate(src => {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    document.body.append(iframe);
  }, `${site}embed/?autoplay=false`);
  await expect(page.frameLocator("iframe").locator(".graph-node")).toHaveCount(6);
  await expect(page.frameLocator("iframe").getByRole("alert")).toHaveCount(0);
});

test("web components isolate themes, keys and state and survive reconnecting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173/");
  await page.addStyleTag({ content: "button { color: magenta !important; }" });
  await page.evaluate(async url => {
    await import(url);
    for (const [id, theme] of [["first", "light"], ["second", "dark"]]) {
      const element = document.createElement("logocausal-network");
      element.id = id;
      element.setAttribute("theme", theme);
      element.setAttribute("autoplay", "false");
      element.setAttribute("width", "600");
      element.setAttribute("height", "400");
      element.style.cssText += ";position:fixed;top:0;left:0;z-index:20";
      if (id === "first") element.setAttribute("embed", "");
      else element.style.left = "620px";
      document.body.append(element);
    }
  }, `${site}logocausal.js`);
  const first = page.locator("#first");
  const second = page.locator("#second");
  await expect(first.locator(".graph-node")).toHaveCount(6);
  await expect(second.locator(".graph-node")).toHaveCount(6);
  await expect(first).toHaveCSS("height", "400px");
  expect(await first.locator(".network-svg").boundingBox()).toEqual({ x: 0, y: 0, width: 600, height: 400 });
  expect(await second.locator(".stage").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await expect(first.locator(".app-shell")).toHaveAttribute("data-theme", "light");
  await expect(second.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(second.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
  await expect(second.getByRole("alert")).toHaveCount(0);
  expect(await second.locator(".brand-mark img").getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(await second.getByRole("button", { name: "Step", exact: true }).evaluate(element => getComputedStyle(element).color)).not.toBe("rgb(255, 0, 255)");
  const sun = first.locator(".sun");
  const before = await sun.getAttribute("transform");
  await first.locator(".app-shell").focus();
  await page.keyboard.press("s");
  await expect(sun).not.toHaveAttribute("transform", before!);
  await expect(second.locator(".hud")).toContainText("T0000");
  await expect(page.locator("#root .hud")).toContainText("/6 ON");
  await first.evaluate(element => { element.setAttribute("theme", "dark"); element.setAttribute("embed", "false"); element.setAttribute("speed", "9"); });
  await expect(first.locator(".slider b")).toHaveText("9/s");
  await expect(first.locator(".hud")).toContainText("T0001");
  await expect(first.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await first.evaluate(element => { element.remove(); document.body.append(element); });
  await expect(first.locator(".graph-node")).toHaveCount(6);
  await expect(first.getByRole("status", { name: "Finding" })).not.toHaveText("Analysing…");
  const populationTab = second.getByRole("tab", { name: "Population", exact: true });
  await populationTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second.getByRole("tab", { name: "Neuron", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(second.getByRole("tab", { name: "Guide", exact: true })).toBeFocused();
  await first.evaluate(element => { element.setAttribute("width", "0.1"); element.setAttribute("height", "0.1"); });
  await expect(first).toHaveCSS("width", "1px");
  await expect(first).toHaveCSS("height", "1px");
  expect(errors).toEqual([]);
});
