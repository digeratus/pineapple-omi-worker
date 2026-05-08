import type { CooldownGate } from "../src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    COOLDOWNS: DurableObjectNamespace<CooldownGate>;
    WEBHOOK_TOKEN: string;
  }
}
