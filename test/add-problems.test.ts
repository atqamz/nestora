import { test } from "node:test";
import assert from "node:assert/strict";
import { DETAILS, problemsOf } from "../src/ui/add-problems.ts";
import type { Detail } from "../src/ui/add-problems.ts";
import { text } from "../src/ui/text.ts";

const values: Record<Detail, string> = { amount: "", due: "", line: "", phone: "", group: "", qty: "1" };

test("a stale invalid amount or phone from another kind never blocks a book", () => {
  assert.deepEqual(problemsOf("book", "Laskar Pelangi", { ...values, amount: "12x", phone: "12", qty: "x" }, []), {});
  assert.deepEqual(problemsOf("planned", "Venue", { ...values, phone: "12" }, []), {});
  assert.deepEqual(problemsOf("task", "Pay", { ...values, phone: "12" }, []), {});
});

test("the kind's own fields still report their problems", () => {
  assert.deepEqual(problemsOf("task", "Pay", { ...values, amount: "12x" }, []), { amount: text.invalid.int });
  assert.deepEqual(problemsOf("guest", "Partner A", { ...values, phone: "12" }, []), { phone: text.invalid.phone });
  assert.deepEqual(problemsOf("guest", "Partner A", { ...values, qty: "0" }, []), { qty: text.sheet.need.qty });
  assert.deepEqual(problemsOf("vendor", "", values, []), { title: text.sheet.need.name });
  assert.deepEqual(problemsOf("payment", "", values, []), { amount: text.sheet.need.amount, line: text.sheet.need.noLines });
  assert.deepEqual(DETAILS.book, []);
});
