import { test, expect } from "@playwright/test";

for (const answer of ["智慧林业2401", "智林2401"]) {
  test(`public experience unlock, personal priority and expiry: ${answer}`, async ({
    page,
  }) => {
    await page.route("https://api.plant.id/v3/usage_info", (route) => {
      expect(route.request().headers()["api-key"]).toBe("personal-kindwise");
      return route.fulfill({ json: {} });
    });
    await page.route("https://api.deepseek.com/models", (route) => {
      expect(route.request().headers().authorization).toBe(
        "Bearer test-public-deepseek",
      );
      return route.fulfill({ json: {} });
    });
    await page.goto("/#settings");
    await page.getByLabel("开发者所在班级是？").fill("incorrect");
    await page.getByRole("button", { name: "验证并启用公共通道" }).click();
    await expect(page.getByRole("alert")).toContainText("答案不正确");
    await page.getByLabel("Kindwise API Key").fill("personal-kindwise");
    await page.getByLabel("开发者所在班级是？").fill(answer);
    await page.getByRole("button", { name: "验证并启用公共通道" }).click();
    await expect(page.getByRole("status")).toContainText("公共体验通道已解锁");
    await page.getByRole("button", { name: "检查密钥连接" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Kindwise 鉴权通过；DeepSeek 鉴权通过",
    );
    const stored = await page.evaluate(() =>
      sessionStorage.getItem("forest-web-settings-v1"),
    );
    expect(stored).not.toContain("test-public-deepseek");
    await page.evaluate(() => {
      const key = "forest-web-settings-v1";
      const s = JSON.parse(sessionStorage.getItem(key)!);
      s.sharedExpires = Date.now() - 1000;
      sessionStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "验证并启用公共通道" }),
    ).toBeVisible();
  });
}
test("short forestry guide and both downloadable documents are accessible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "使用说明", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "拍清楚，看证据，再判断。" }),
  ).toBeVisible();
  expect(await page.locator("a[download]").count()).toBe(2);
  for (const href of await page
    .locator("a[download]")
    .evaluateAll((elements) =>
      elements.map((e) => (e as HTMLAnchorElement).href),
    )) {
    const response = await page.request.get(href);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("病");
  }
});
