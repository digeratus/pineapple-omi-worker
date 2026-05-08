import { DurableObject } from "cloudflare:workers";

type TranscriptSegment = {
  text?: unknown;
  speaker?: unknown;
  speakerId?: unknown;
  speaker_name?: unknown;
  is_user?: unknown;
  start?: unknown;
  end?: unknown;
};

type TranscriptPayload = {
  session_id?: unknown;
  segments?: unknown;
};

type Env = {
  COOLDOWNS: DurableObjectNamespace<CooldownGate>;
  WEBHOOK_TOKEN: string;
};

const DEFAULT_SESSION_ID = "unknown";
const TRIGGER_WORD = "pineapple";
const COOLDOWN_SECONDS = 30;
const TRIGGER_PATTERN = new RegExp(`(?<![A-Za-z0-9_])${TRIGGER_WORD}(?![A-Za-z0-9_])`, "i");

export class CooldownGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS cooldowns (
          key TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        )
      `);
    });
  }

  async checkAndSet(key: string, cooldownSeconds: number, now = Date.now()): Promise<boolean> {
    const existing = this.ctx.storage.sql
      .exec<{ expires_at: number }>("SELECT expires_at FROM cooldowns WHERE key = ?", key)
      .toArray()[0];

    if (existing && existing.expires_at > now) {
      return false;
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO cooldowns (key, expires_at) VALUES (?, ?)",
      key,
      now + cooldownSeconds * 1000
    );
    return true;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          status: "ok",
          trigger_word: TRIGGER_WORD,
          cooldown_seconds: COOLDOWN_SECONDS
        });
      }

      if (url.pathname === "/webhook" && request.method === "POST") {
        return handleWebhook(request, env);
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Request failed",
          error: error instanceof Error ? error.message : String(error)
        })
      );
      return json({ error: "Internal server error" }, { status: 500 });
    }
  }
};

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env.WEBHOOK_TOKEN)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const payload = parseTranscriptPayload(await request.json());
  const sessionId = payload.sessionId || url.searchParams.get("session_id") || DEFAULT_SESSION_ID;
  const response: Record<string, unknown> = { session_id: sessionId };

  if (!TRIGGER_PATTERN.test(payload.transcript)) {
    return json(response);
  }

  const cooldownKey = url.searchParams.get("uid") || sessionId;
  const gate = env.COOLDOWNS.getByName(cooldownKey);
  const shouldNotify = await gate.checkAndSet(cooldownKey, COOLDOWN_SECONDS);

  if (!shouldNotify) {
    return json(response);
  }

  response.notification = {
    prompt: "Tell {{user_name}}: Pineapple detected.",
    params: ["user_name"]
  };

  return json(response);
}

function parseTranscriptPayload(body: unknown): { sessionId?: string; transcript: string } {
  if (Array.isArray(body)) {
    return { transcript: extractTranscript(body) };
  }

  if (isRecord(body)) {
    const payload = body as TranscriptPayload;
    return {
      sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
      transcript: Array.isArray(payload.segments) ? extractTranscript(payload.segments) : ""
    };
  }

  return { transcript: "" };
}

function extractTranscript(segments: unknown[]): string {
  return segments
    .map((segment) => {
      if (!isRecord(segment)) {
        return "";
      }

      const transcriptSegment = segment as TranscriptSegment;
      return typeof transcriptSegment.text === "string" ? transcriptSegment.text : "";
    })
    .join(" ");
}

function isAuthorized(request: Request, expectedToken: string): boolean {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const suppliedToken = queryToken || bearerToken || "";

  return timingSafeEqual(suppliedToken, expectedToken);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }

  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  });
}
