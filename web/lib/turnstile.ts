"use client";

import { TURNSTILE_SITE_KEY } from "./env";

/**
 * Cloudflare Turnstile, used to gate anonymous sign-in.
 *
 * Why this exists. A session costs one unauthenticated request, and the app
 * mints one on first load by design — that is what makes swiping work with no
 * signup wall. The cost is that account creation is free and unlimited, which is
 * the one abuse vector the swipe cap and the API rate limits do not touch: they
 * bound what a single account or address can do, not how many accounts exist.
 * See SPEC "Abuse limits" and db/migrations/0016.
 *
 * This file is not the security boundary. Supabase verifies the token against
 * Cloudflare with a secret this code never sees, so a forged or absent token
 * fails there, not here. That is why nothing below throws: if the script is
 * blocked, the network is down, or the challenge fails, we return undefined and
 * let sign-in proceed without a token. Supabase then either rejects it (when
 * CAPTCHA is enabled) with an error naming the real cause, or ignores it (when
 * it is not). Failing closed in the browser would only convert "Supabase says
 * your challenge failed" into "the app is broken and will not say why", while
 * blocking exactly nobody who is actually attacking this.
 *
 * `appearance: "interaction-only"` keeps the widget invisible for the large
 * majority who pass silently, and draws it only when Cloudflare genuinely wants
 * a human. That is also why the container is positioned in real layout rather
 * than hidden off-screen: a widget that needs interaction but cannot be seen is
 * a dead end for the user it is asking.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Generous, because it bounds a first paint. The widget normally settles in well
 * under a second; this is here so a hung script cannot leave a visitor watching
 * an empty deck forever.
 */
const TIMEOUT_MS = 15_000;

interface RenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  theme: "light" | "dark" | "auto";
}

interface Turnstile {
  render: (element: HTMLElement, options: RenderOptions) => string | undefined;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/**
 * One script tag per page, however many times a token is asked for. Memoised on
 * the promise rather than a boolean so that two concurrent callers await the
 * same load instead of racing to append a second tag.
 */
let scriptLoad: Promise<boolean> | null = null;

function loadScript(): Promise<boolean> {
  if (scriptLoad) return scriptLoad;

  scriptLoad = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      // Already in the document from an earlier mount. `window.turnstile` may or
      // may not be ready yet, so resolve on its events rather than assuming.
      if (window.turnstile) return resolve(true);
      existing.addEventListener("load", () => resolve(Boolean(window.turnstile)));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(Boolean(window.turnstile)));
    script.addEventListener("error", () => resolve(false));
    document.head.appendChild(script);
  });

  return scriptLoad;
}

/**
 * A fresh widget per token.
 *
 * Turnstile tokens are single-use and expire, and this runs once per visitor —
 * only when there is no session to resume — so the cost of building and tearing
 * down a widget is irrelevant next to the state machine that reusing one would
 * require (reset, execute, and the races between them).
 */
function solve(sitekey: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const turnstile = window.turnstile;
    if (!turnstile) return resolve(undefined);

    const host = document.createElement("div");
    // Real layout, not `display: none`: an interaction-only widget that escalates
    // has to be reachable. Fixed and centred near the bottom so it reads as a
    // prompt rather than as part of the deck. It occupies no space until
    // Cloudflare draws something into it.
    host.style.position = "fixed";
    host.style.left = "50%";
    host.style.bottom = "24px";
    host.style.transform = "translateX(-50%)";
    host.style.zIndex = "100";
    document.body.appendChild(host);

    let widgetId: string | undefined;
    let settled = false;

    const finish = (token: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (widgetId !== undefined) {
        try {
          turnstile.remove(widgetId);
        } catch {
          // Already gone. Nothing to do, and nothing worth failing sign-in over.
        }
      }
      host.remove();
      resolve(token);
    };

    const timer = setTimeout(() => finish(undefined), TIMEOUT_MS);

    try {
      widgetId = turnstile.render(host, {
        sitekey,
        appearance: "interaction-only",
        theme: "dark",
        callback: (token) => finish(token),
        "error-callback": () => finish(undefined),
        "expired-callback": () => finish(undefined),
      });
    } catch {
      finish(undefined);
    }

    // render() returns undefined when it refuses the container outright, which
    // no callback follows — without this the caller would wait out the timeout
    // for an answer that was never coming.
    if (widgetId === undefined) finish(undefined);
  });
}

/**
 * A Turnstile token, or undefined if one could not be obtained for any reason.
 *
 * Undefined is a normal return, not an error: it also covers the case where no
 * site key is configured, which is how local development and any environment
 * without CAPTCHA keep working unchanged.
 */
export async function captchaToken(): Promise<string | undefined> {
  if (!TURNSTILE_SITE_KEY) return undefined;
  if (typeof window === "undefined") return undefined;
  if (!(await loadScript())) return undefined;
  return await solve(TURNSTILE_SITE_KEY);
}
