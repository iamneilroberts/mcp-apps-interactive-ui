/**
 * The widget. ONE file that works in two modes:
 *
 *   • In a host (claude.ai / Desktop): connects over the postMessage bridge,
 *     fetches state with app.callServerTool(), and uses the host capabilities
 *     (sendMessage, updateModelContext, downloadFile, requestDisplayMode, sendLog).
 *
 *   • Standalone (opened directly in a browser, no host): skips the bridge and
 *     renders embedded mock data, so you can see and screenshot it without a
 *     running server. The capability buttons no-op with a console note.
 *
 * The RENDER is pure DOM and identical in both modes. Only the host-comms verbs
 * branch on `inHost`.
 */

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---- types mirroring the server's stateFor() ----
interface Option { id: string; label: string; blurb: string; price: number; }
interface Group { id: string; title: string; kind: "single" | "multi"; options: Option[]; }
interface Menu { groups: Group[]; basePrice: number; hero: { url: string; alt: string }; }
interface State {
  orderId: string;
  menu: Menu;
  selections: Record<string, string[]>;
  total: number;
  summary: string;
}

// ---- embedded mock for standalone viewing (mirrors src/data.ts) ----
const MOCK_MENU: Menu = {
  basePrice: 9,
  hero: {
    url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=900&q=80",
    alt: "A wood-fired pizza",
  },
  groups: [
    { id: "size", title: "Size", kind: "single", options: [
      { id: "s", label: "Small", blurb: '10" · serves 1', price: 0 },
      { id: "m", label: "Medium", blurb: '12" · serves 2', price: 3 },
      { id: "l", label: "Large", blurb: '16" · serves 3–4', price: 6 },
    ]},
    { id: "crust", title: "Crust", kind: "single", options: [
      { id: "thin", label: "Thin & crispy", blurb: "the classic", price: 0 },
      { id: "deep", label: "Deep dish", blurb: "Chicago style", price: 2 },
      { id: "sour", label: "Sourdough", blurb: "48-hour ferment", price: 3 },
    ]},
    { id: "toppings", title: "Toppings", kind: "multi", options: [
      { id: "pepperoni", label: "Pepperoni", blurb: "cured, spicy", price: 2 },
      { id: "mushroom", label: "Mushroom", blurb: "cremini", price: 1 },
      { id: "basil", label: "Fresh basil", blurb: "torn, finished raw", price: 1 },
      { id: "olives", label: "Kalamata olives", blurb: "pitted", price: 2 },
      { id: "chili", label: "Chili honey", blurb: "hot + sweet drizzle", price: 2 },
    ]},
  ],
};

function priceOf(menu: Menu, selections: Record<string, string[]>): number {
  let total = menu.basePrice;
  for (const g of menu.groups)
    for (const oid of selections[g.id] ?? [])
      total += g.options.find((o) => o.id === oid)?.price ?? 0;
  return total;
}
function summarize(menu: Menu, selections: Record<string, string[]>): string {
  const parts: string[] = [];
  for (const g of menu.groups) {
    const labels = (selections[g.id] ?? [])
      .map((oid) => g.options.find((o) => o.id === oid)?.label).filter(Boolean);
    if (labels.length) parts.push(`${g.title.toLowerCase()}: ${labels.join(", ")}`);
  }
  return `${parts.join(" · ")} — $${priceOf(menu, selections)}`;
}
function mockState(): State {
  const selections = { size: ["m"], crust: ["thin"], toppings: ["pepperoni"] };
  return {
    orderId: "order-demo", menu: MOCK_MENU, selections,
    total: priceOf(MOCK_MENU, selections), summary: summarize(MOCK_MENU, selections),
  };
}

// ---- mode detection: are we inside a host iframe? ----
const inHost = window.parent && window.parent !== window;

const root = document.getElementById("root")!;
let app: App | null = null;
let state: State = mockState();
let displayMode: string = "inline";

// ---- host capability probes (guarded; absent host => false) ----
function caps(): Record<string, unknown> {
  return (app?.getHostCapabilities() as Record<string, unknown>) ?? {};
}
const can = {
  message: () => !!caps().message,
  modelContext: () => !!caps().updateModelContext,
  download: () => !!caps().downloadFile,
  log: () => !!caps().logging,
  fullscreen: () =>
    (app?.getHostContext()?.availableDisplayModes ?? []).includes("fullscreen"),
};

function log(level: "info" | "warning", data: unknown) {
  if (inHost && can.log()) app?.sendLog({ level, data });
}

// ---- render (pure DOM; identical in both modes) ----
function render() {
  const m = state.menu;
  const sel = state.selections;
  root.innerHTML = "";

  if (!inHost) {
    const note = el("div", "standalone-note",
      "Standalone preview (no MCP host). Picks update locally; capability buttons no-op.");
    root.appendChild(note);
  }

  if (m.hero?.url) {
    const hero = el("div", "hero");
    const img = document.createElement("img");
    img.src = m.hero.url;
    img.alt = m.hero.alt;
    img.onerror = () => hero.remove(); // hide gracefully if CSP/network blocks it
    hero.appendChild(img);
    hero.appendChild(el("div", "hero-cap", "Build your pizza"));
    root.appendChild(hero);
  }

  const head = el("div", "head");
  head.appendChild(el("div", "eyebrow", "MCP App Demo"));
  head.appendChild(el("h1", "", "Pizza Builder"));
  head.appendChild(el("div", "sub", "Pick your options. The price updates live."));
  root.appendChild(head);

  // capability toolbar
  const tools = el("div", "tools");
  if (can.fullscreen())
    tools.appendChild(btn(displayMode === "fullscreen" ? "⤡ Collapse" : "⤢ Expand", toggleFullscreen));
  if (!inHost || can.download())
    tools.appendChild(btn("⤓ Receipt", downloadReceipt));
  tools.appendChild(btn("☾ Theme", toggleTheme));
  root.appendChild(tools);

  for (const g of m.groups) {
    const group = el("div", "group");
    group.appendChild(el("h2", "", g.title));
    for (const o of g.options) {
      const checked = (sel[g.id] ?? []).includes(o.id);
      const opt = el("div", "opt");
      opt.dataset.kind = g.kind;
      opt.setAttribute("role", g.kind === "single" ? "radio" : "checkbox");
      opt.setAttribute("aria-checked", String(checked));
      opt.appendChild(el("div", "mark"));
      const body = el("div", "body");
      body.appendChild(el("div", "label", o.label));
      body.appendChild(el("div", "blurb", o.blurb));
      opt.appendChild(body);
      opt.appendChild(el("div", "price", o.price ? `+$${o.price}` : "included"));
      opt.addEventListener("click", () => pick(g.id, o.id));
      group.appendChild(opt);
    }
    root.appendChild(group);
  }

  const total = el("div", "total");
  const left = el("div", "left");
  left.appendChild(el("div", "amt", `$${state.total}`));
  left.appendChild(el("div", "sum", state.summary));
  total.appendChild(left);
  total.appendChild(btn("Place order →", placeOrder, "order"));
  root.appendChild(total);

  app?.sendSizeChanged?.({ height: document.documentElement.scrollHeight });
}

// ---- actions ----
async function pick(groupId: string, optionId: string) {
  if (inHost) {
    try {
      const res = await app!.callServerTool({
        name: "pizza_pick",
        arguments: { orderId: state.orderId, groupId, optionId },
      });
      const next = readState(res);
      if (next) state = next;
    } catch (e) {
      log("warning", { event: "pick_failed", error: String(e) });
      return; // leave the board unchanged rather than rendering a half-applied pick
    }
  } else {
    const g = state.menu.groups.find((x) => x.id === groupId)!;
    if (g.kind === "single") state.selections[groupId] = [optionId];
    else {
      const cur = new Set(state.selections[groupId] ?? []);
      cur.has(optionId) ? cur.delete(optionId) : cur.add(optionId);
      state.selections[groupId] = [...cur];
    }
    state.total = priceOf(state.menu, state.selections);
    state.summary = summarize(state.menu, state.selections);
  }
  render();
}

/**
 * The 2-way handoff. updateModelContext STAGES the order silently (it does not
 * trigger a model turn and keeps only the last update). sendMessage is the only
 * host->model call that actually triggers a turn. Canonical pattern: stage, then
 * send. Both are cap-guarded. On claude.ai web, sendMessage shows a red "use
 * caution" banner — that is host safety UX and cannot be suppressed.
 */
async function placeOrder() {
  if (!inHost) { console.info("[standalone] would place order:", state.summary); return; }
  if (can.modelContext())
    await app!.updateModelContext({ content: [{ type: "text", text: `Current pizza: ${state.summary}` }] });
  if (can.message()) {
    await app!.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Place my pizza order — ${state.summary}.` }],
    });
  } else {
    log("warning", { event: "no_message_capability" });
    console.info("Host lacks `message` capability; cannot hand back to the model.");
  }
}

async function downloadReceipt() {
  const receipt = `PIZZA ORDER RECEIPT\n\n${state.summary.replace(/ · /g, "\n")}\n\nTotal: $${state.total}\n`;
  if (!inHost || !can.download()) { console.info("[no downloadFile cap]\n" + receipt); return; }
  await app!.downloadFile({
    contents: [{
      type: "resource",
      resource: {
        // Encode as UTF-8. btoa() throws on any character above U+00FF (an em dash,
        // an accented name, an emoji topping), so never base64 a Unicode string here.
        uri: "data:text/plain;charset=utf-8," + encodeURIComponent(receipt),
        mimeType: "text/plain",
        text: receipt,
      },
    }],
  });
}

async function toggleFullscreen() {
  if (!inHost) return;
  const target = displayMode === "fullscreen" ? "inline" : "fullscreen";
  const res = await app!.requestDisplayMode({ mode: target });
  // Trust the mode the host actually set, not the one we asked for.
  displayMode = (res as { mode?: string })?.mode ?? target;
  document.documentElement.dataset.fbMode = displayMode;
  render();
}

function toggleTheme() {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  document.documentElement.dataset.theme = next;
}

// ---- host context (theme/fonts) ----
function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.displayMode) {
    displayMode = ctx.displayMode;
    document.documentElement.dataset.fbMode = displayMode;
  }
}

// ---- helpers ----
function readState(res: CallToolResult): State | null {
  const sc = res.structuredContent as State | undefined;
  return sc?.menu ? sc : null;
}
function el(tag: string, cls = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}
function btn(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// ---- boot ----
async function boot() {
  if (!inHost) { render(); return; }

  app = new App({ name: "Pizza Builder", version: "1.0.0" });

  // The launcher tool result arrives here. It carries only { orderId }; we fetch
  // the full state ourselves (the token-economy split — see docs/06).
  app.ontoolresult = async (res: CallToolResult) => {
    const orderId = (res.structuredContent as { orderId?: string })?.orderId;
    if (!orderId) return;
    const stateRes = await app!.callServerTool({ name: "pizza_state", arguments: { orderId } });
    const next = readState(stateRes);
    if (next) { state = next; render(); }
  };
  app.onhostcontextchanged = applyContext;

  await app.connect();
  const ctx = app.getHostContext();
  if (ctx) applyContext(ctx);

  // Telemetry: dump what the host actually granted us (handy when debugging).
  log("info", { event: "connected", capabilities: caps(), context: app.getHostContext() });

  render(); // render immediately; ontoolresult will refine when the tool result lands
}

boot();
