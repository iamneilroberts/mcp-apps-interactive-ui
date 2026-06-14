import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, applyPick, priceOf, summarize } from "../src/data.js";

test("default order prices the base plus default selections", () => {
  // base 9 + size m (+3) + crust thin (+0) + topping pepperoni (+2) = 14
  const order = createOrder();
  assert.equal(priceOf(order), 14);
});

test("single-select replaces the choice", () => {
  const order = createOrder();
  applyPick(order.id, "size", "l"); // large +6
  assert.deepEqual(order.selections.size, ["l"]);
  assert.equal(priceOf(order), 9 + 6 + 0 + 2);
});

test("multi-select toggles membership", () => {
  const order = createOrder();
  applyPick(order.id, "toppings", "mushroom"); // add
  assert.deepEqual(order.selections.toppings.sort(), ["mushroom", "pepperoni"]);
  applyPick(order.id, "toppings", "mushroom"); // remove
  assert.deepEqual(order.selections.toppings, ["pepperoni"]);
});

test("summarize lists groups and the total", () => {
  const order = createOrder();
  const s = summarize(order);
  assert.match(s, /size: Medium/);
  assert.match(s, /\$14$/);
});

test("invalid input returns undefined and changes nothing", () => {
  const order = createOrder();
  const before = JSON.stringify(order.selections);
  assert.equal(applyPick(order.id, "size", "nonexistent"), undefined); // bad option
  assert.equal(applyPick(order.id, "nogroup", "m"), undefined); // bad group
  assert.equal(applyPick("no-such-order", "size", "m"), undefined); // bad order
  assert.equal(JSON.stringify(order.selections), before);
});
