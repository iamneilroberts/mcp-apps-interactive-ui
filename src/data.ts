/**
 * Toy domain: a pizza order builder.
 *
 * Deliberately mundane so the MCP-Apps mechanics stay in focus. The shape here
 * mirrors a real "compare-and-pick" board: a few decision groups (size, crust,
 * toppings), each with options that carry a price delta, plus a running total.
 *
 * State is held in a module-level Map keyed by orderId. That is fine for a demo
 * running in a warm process; a production server would persist to a database /
 * KV and key by a real user + resource id. See docs/06-token-economy.md for why
 * the *model* never sees this whole object — only a tiny ref.
 */

export interface Option {
  id: string;
  label: string;
  /** Short human description shown under the label. */
  blurb: string;
  /** Price delta in whole dollars added to the order when selected. */
  price: number;
}

export interface Group {
  id: string;
  title: string;
  /** "single" = radio (pick one); "multi" = checkboxes (pick any). */
  kind: "single" | "multi";
  options: Option[];
}

export interface Menu {
  groups: Group[];
  /** Base price before any options. */
  basePrice: number;
  /** External image, loaded only because the server declares its domain in CSP. */
  hero: { url: string; alt: string };
}

export const MENU: Menu = {
  basePrice: 9,
  hero: {
    // Loads in-host ONLY because the server declares images.unsplash.com in
    // _meta.ui.csp.resourceDomains. Remove that declaration and the host's
    // default sandbox CSP (img-src 'self' data:) blocks it. See docs/04.
    url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=900&q=80",
    alt: "A wood-fired pizza",
  },
  groups: [
    {
      id: "size",
      title: "Size",
      kind: "single",
      options: [
        { id: "s", label: "Small", blurb: "10\" · serves 1", price: 0 },
        { id: "m", label: "Medium", blurb: "12\" · serves 2", price: 3 },
        { id: "l", label: "Large", blurb: "16\" · serves 3–4", price: 6 },
      ],
    },
    {
      id: "crust",
      title: "Crust",
      kind: "single",
      options: [
        { id: "thin", label: "Thin & crispy", blurb: "the classic", price: 0 },
        { id: "deep", label: "Deep dish", blurb: "Chicago style", price: 2 },
        { id: "sour", label: "Sourdough", blurb: "48-hour ferment", price: 3 },
      ],
    },
    {
      id: "toppings",
      title: "Toppings",
      kind: "multi",
      options: [
        { id: "pepperoni", label: "Pepperoni", blurb: "cured, spicy", price: 2 },
        { id: "mushroom", label: "Mushroom", blurb: "cremini", price: 1 },
        { id: "basil", label: "Fresh basil", blurb: "torn, finished raw", price: 1 },
        { id: "olives", label: "Kalamata olives", blurb: "pitted", price: 2 },
        { id: "chili", label: "Chili honey", blurb: "hot + sweet drizzle", price: 2 },
      ],
    },
  ],
};

/** A live order: which option(s) are selected per group. */
export interface Order {
  id: string;
  /** group id -> selected option id(s). single => one id; multi => many. */
  selections: Record<string, string[]>;
}

const ORDERS = new Map<string, Order>();

/** Deterministic-ish id without pulling in a uuid dep. */
function newId(): string {
  const n = ORDERS.size + 1;
  return `order-${n.toString().padStart(4, "0")}`;
}

export function createOrder(): Order {
  const order: Order = {
    id: newId(),
    // Sensible defaults so the board never opens empty.
    selections: { size: ["m"], crust: ["thin"], toppings: ["pepperoni"] },
  };
  ORDERS.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return ORDERS.get(id);
}

/** Apply a pick. Radio groups replace; multi groups toggle membership. */
export function applyPick(id: string, groupId: string, optionId: string): Order | undefined {
  const order = ORDERS.get(id);
  if (!order) return undefined;
  const group = MENU.groups.find((g) => g.id === groupId);
  if (!group) return order;

  if (group.kind === "single") {
    order.selections[groupId] = [optionId];
  } else {
    const cur = new Set(order.selections[groupId] ?? []);
    cur.has(optionId) ? cur.delete(optionId) : cur.add(optionId);
    order.selections[groupId] = [...cur];
  }
  return order;
}

/** Total price for an order, given the menu. */
export function priceOf(order: Order): number {
  let total = MENU.basePrice;
  for (const group of MENU.groups) {
    for (const optId of order.selections[group.id] ?? []) {
      total += group.options.find((o) => o.id === optId)?.price ?? 0;
    }
  }
  return total;
}

/** A short, human summary of the order — used for the model handoff. */
export function summarize(order: Order): string {
  const parts: string[] = [];
  for (const group of MENU.groups) {
    const labels = (order.selections[group.id] ?? [])
      .map((oid) => group.options.find((o) => o.id === oid)?.label)
      .filter(Boolean);
    if (labels.length) parts.push(`${group.title.toLowerCase()}: ${labels.join(", ")}`);
  }
  return `${parts.join(" · ")} — $${priceOf(order)}`;
}
