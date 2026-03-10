describe("next config headers", () => {
  it("defines the expected public security headers", async () => {
    const config = (await import("@/next.config.mjs")).default
    const rules = await config.headers()
    const rootRule = rules.find((rule: { source: string }) => rule.source === "/:path*")

    expect(rootRule).toBeDefined()
    if (!rootRule) {
      throw new Error("Expected root header rule to be defined.")
    }

    expect(rootRule.headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Content-Security-Policy",
          value: expect.stringContaining("frame-ancestors 'none'"),
        }),
        expect.objectContaining({
          key: "X-Frame-Options",
          value: "DENY",
        }),
        expect.objectContaining({
          key: "X-Content-Type-Options",
          value: "nosniff",
        }),
        expect.objectContaining({
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        }),
      ]),
    )
  })
})
