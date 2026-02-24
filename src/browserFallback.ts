import { chromium } from "playwright";

import { playwrightProxyConfig, type RuntimeProxySettings } from "./proxy";

export async function fetchHtmlWithBrowser(url: string, proxySettings: RuntimeProxySettings): Promise<{ status: number; url: string; html: string }> {
  const browser = await chromium.launch({ headless: true, proxy: playwrightProxyConfig(proxySettings) });
  try {
    const context = await browser.newContext({ userAgent: "StealthDockYouTubeScraper/1.0 (+https://stealthdock.local)" });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    return {
      status: response?.status() ?? 200,
      url: page.url() || url,
      html: await page.content(),
    };
  } finally {
    await browser.close();
  }
}
