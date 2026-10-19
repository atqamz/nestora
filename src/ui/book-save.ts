import type { Side } from "../../shared/api.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { sortBefore } from "../domain/order.ts";
import { lastPlace } from "../domain/places.ts";
import type { Store, Written } from "../store/store.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

export type BookKind = "shelf" | "wish";

export type BookOwner = "a" | "b" | "both";

export type BookInput = {
  kind: BookKind;
  title: string;
  author: string;
  original: string;
  isbn: string;
  ownerPick: BookOwner | null;
  placePick: string | null;
};

export const bookDefaults = (input: Pick<BookInput, "kind" | "ownerPick" | "placePick">, items: readonly ItemRow[], me: Side | null) => ({
  owner: input.ownerPick ?? (input.kind === "shelf" ? "both" : (me ?? "both")),
  placeId: input.placePick ?? lastPlace(items) ?? "",
});

export const saveBook = async (items: readonly ItemRow[], create: Store["create"], input: BookInput, me: Side | null): Promise<Written> => {
  const title = input.title.trim();
  const checked = parseField("isbn", input.isbn);
  if (title === "") return { ok: false, errors: [text.books.sheet.needTitle] };
  if (!checked.ok) return { ok: false, errors: [text.invalid.isbn] };
  const { owner, placeId } = bookDefaults(input, items, me);
  const code = checked.value !== null ? { isbn: String(checked.value) } : {};
  const data = Object.fromEntries(Object.entries({ author: input.author.trim(), original_title: input.original.trim() }).filter(([, value]) => value !== ""));
  const book = await create("items", {
    kind: "book",
    title,
    status: input.kind,
    who: input.kind === "wish" ? owner : null,
    sort: sortBefore(items.filter((row) => row.kind === "book" && row.status === input.kind)),
    data: { ...data, ...code },
  });
  const copy =
    book.ok && input.kind === "shelf"
      ? await create("items", {
          kind: "copy",
          parent_id: book.id,
          title,
          status: "here",
          who: owner,
          group_key: placeId === "" ? null : placeId,
          data: { format: "print", ...code },
        })
      : book;
  if (copy.ok) {
    overlay.keepBook(null);
    overlay.keepDraft(null);
  }
  return copy;
};
