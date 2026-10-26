import { test } from "node:test";
import assert from "node:assert/strict";
import { tables } from "../shared/tables.ts";
import { views } from "../src/ui/registry.ts";

test("every field a view lists is a column or data key of its variant, so a save cannot be refused for a field the variant lacks", () => {
  for (const [name, view] of Object.entries(views)) {
    const table = tables[view.table];
    const variant = (table.variants as Record<string, { columns: readonly string[]; data: Record<string, unknown> }>)[view.variant];
    for (const field of view.fields) {
      const known = field.startsWith("data.") ? field.slice(5) in variant.data : [...variant.columns, ...table.common].includes(field);
      assert.ok(known, `${name}: ${field}`);
    }
  }
});

test("the money line has no Note field", () => {
  assert.deepEqual(views.planned.fields, ["group_key", "amount"]);
});
