import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const token = "test-token";

describe("Pineapple Omi Worker", () => {
  it("returns health status", async () => {
    const response = await SELF.fetch("https://worker.example/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      trigger_word: "pineapple",
      cooldown_seconds: 30
    });
  });

  it("rejects missing webhook tokens", async () => {
    const response = await SELF.fetch("https://worker.example/webhook", {
      method: "POST",
      body: JSON.stringify({ segments: [{ text: "pineapple" }] })
    });

    expect(response.status).toBe(401);
  });

  it("rejects invalid webhook tokens", async () => {
    const response = await postWebhook("bad-token", "session-invalid", "user-invalid", {
      segments: [{ text: "pineapple" }]
    });

    expect(response.status).toBe(401);
  });

  it("does not notify without the trigger word", async () => {
    const response = await postWebhook(token, "session-normal", "user-normal", {
      segments: [{ text: "This is just a normal sentence." }]
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session_id: "session-normal" });
  });

  it("returns a notification for pineapple", async () => {
    const response = await postWebhook(token, "session-trigger", "user-trigger", {
      segments: [{ text: "Please remember pineapple for later." }]
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session_id: "session-trigger",
      notification: {
        prompt: "Tell {{user_name}}: Pineapple detected.",
        params: ["user_name"]
      }
    });
  });

  it("suppresses duplicate notifications within the cooldown", async () => {
    const first = await postWebhook(token, "session-duplicate", "user-duplicate", {
      segments: [{ text: "pineapple" }]
    });
    const second = await postWebhook(token, "session-duplicate", "user-duplicate", {
      segments: [{ text: "pineapple again" }]
    });

    expect(await first.json()).toHaveProperty("notification");
    expect(await second.json()).toEqual({ session_id: "session-duplicate" });
  });

  it("does not share cooldown between different users", async () => {
    const first = await postWebhook(token, "session-shared", "user-one", {
      segments: [{ text: "pineapple" }]
    });
    const second = await postWebhook(token, "session-shared", "user-two", {
      segments: [{ text: "pineapple" }]
    });

    expect(await first.json()).toHaveProperty("notification");
    expect(await second.json()).toHaveProperty("notification");
  });

  it("accepts raw segment array payloads", async () => {
    const response = await postWebhook(token, "session-array", "user-array", [
      { text: "PINEAPPLE", speaker: "SPEAKER_00", is_user: true }
    ]);

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("notification");
  });

  it("does not match partial words", async () => {
    const response = await postWebhook(token, "session-partial", "user-partial", {
      segments: [{ text: "pineappled and not the word" }]
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session_id: "session-partial" });
  });

  it("accepts bearer tokens", async () => {
    const response = await SELF.fetch("https://worker.example/webhook?session_id=session-bearer&uid=user-bearer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ segments: [{ text: "pineapple" }] })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("notification");
  });
});

function postWebhook(tokenValue: string, sessionId: string, uid: string, body: unknown): Promise<Response> {
  const url = new URL("https://worker.example/webhook");
  url.searchParams.set("token", tokenValue);
  url.searchParams.set("session_id", sessionId);
  url.searchParams.set("uid", uid);

  return SELF.fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
