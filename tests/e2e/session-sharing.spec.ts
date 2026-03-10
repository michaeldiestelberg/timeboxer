import { expect, test } from "@playwright/test"

test("shares setup and live session controls across browsers", async ({ browser, page, request }) => {
  const currentParticipantFor = (targetPage: typeof page) =>
    targetPage.locator('[data-testid="current-participant"]:visible').last()
  const countdownFor = (targetPage: typeof page) =>
    targetPage.locator('[data-testid="countdown"]:visible').last()

  await page.goto("/")
  await page.getByRole("button", { name: "Create shared session" }).click()

  await page.getByLabel("Participant name").fill("Alice")
  await page.getByRole("button", { name: "Add" }).click()
  await page.getByLabel("Participant name").fill("Bob")
  await page.getByRole("button", { name: "Add" }).click()
  await page.getByLabel("Participant name").fill("Cara")
  await page.getByRole("button", { name: "Add" }).click()
  await page.getByRole("button", { name: "Start session" }).click()

  const sessionUrl = page.url()
  const sessionId = sessionUrl.split("/").pop()
  if (!sessionId) {
    throw new Error("Session ID was not present in the URL.")
  }

  const initialSnapshotResponse = await request.get(`/api/sessions/${sessionId}`)
  const initialSnapshot = (await initialSnapshotResponse.json()) as {
    session: { currentParticipant: string | null }
  }
  const initialParticipant = initialSnapshot.session.currentParticipant
  if (!initialParticipant) {
    throw new Error("Expected a current participant after starting the session.")
  }

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await secondPage.goto(sessionUrl)

  await expect(currentParticipantFor(secondPage)).toHaveText(initialParticipant)

  await page.getByTestId("start-turn").last().click()
  await expect(countdownFor(secondPage)).not.toHaveText("01:00")

  await secondPage.getByTestId("pause-turn").last().click()
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()

  await secondPage.getByTestId("next-participant-button").last().click()
  await expect
    .poll(async () => {
      const response = await request.get(`/api/sessions/${sessionId}`)
      const payload = (await response.json()) as { session: { currentParticipant: string | null } }
      return payload.session.currentParticipant
    })
    .not.toBe(initialParticipant)

  const nextSnapshotResponse = await request.get(`/api/sessions/${sessionId}`)
  const nextSnapshot = (await nextSnapshotResponse.json()) as {
    session: { currentParticipant: string | null }
  }
  const nextParticipant = nextSnapshot.session.currentParticipant
  if (!nextParticipant) {
    throw new Error("Expected a new current participant after advancing the session.")
  }

  await expect(currentParticipantFor(page)).toHaveText(nextParticipant)
  await expect(currentParticipantFor(secondPage)).toHaveText(nextParticipant)
  await expect(page.getByTestId("countdown").last()).not.toHaveClass(/flashing-timer/)
  await expect(secondPage.getByTestId("countdown").last()).not.toHaveClass(/flashing-timer/)

  await secondContext.close()
})

test("serves security headers on public pages", async ({ page, request }) => {
  const homeResponse = await request.get("/")

  expect(homeResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(homeResponse.headers()["x-frame-options"]).toBe("DENY")
  expect(homeResponse.headers()["x-content-type-options"]).toBe("nosniff")

  await page.goto("/")
  await page.getByRole("button", { name: "Create shared session" }).click()

  const sessionPath = new URL(page.url()).pathname
  const sessionResponse = await request.get(sessionPath)

  expect(sessionResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(sessionResponse.headers()["x-frame-options"]).toBe("DENY")
})
