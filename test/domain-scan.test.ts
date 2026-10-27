import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isbnCheck } from "../src/domain/isbn.ts";
import { INTERVAL, LIMIT, accept, camera, frameOf, fresh, refusal, scan, timer } from "../src/domain/scan.ts";
import type { Deps, Stream, Timer } from "../src/domain/scan.ts";
import { isbnNote } from "../src/ui/isbn-note.ts";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const LASKAR = "9789793062792";

const PRINCE = "9780156012195";

const clock = () => {
  const jobs = new Map<number, { run: () => void; ms: number; every: boolean; due: number }>();
  let now = 0;
  let id = 0;
  const add = (run: () => void, ms: number, every: boolean) => {
    const mine = ++id;
    jobs.set(mine, { run, ms, every, due: now + ms });
    return () => void jobs.delete(mine);
  };
  const timer: Timer = { every: (run, ms) => add(run, ms, true), after: (run, ms) => add(run, ms, false) };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs.entries()].filter(([, job]) => job.due <= end).sort(([, a], [, b]) => a.due - b.due)[0];
      if (!next) break;
      const [key, job] = next;
      now = job.due;
      if (job.every) job.due += job.ms;
      else jobs.delete(key);
      job.run();
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    }
    now = end;
  };
  return { timer, advance, pending: () => jobs.size };
};

const rig = (over: Partial<Deps> & { codes?: (string | undefined)[][] } = {}) => {
  const time = clock();
  const stopped: number[] = [];
  const calls = { detect: 0, show: 0, getStream: 0 };
  const queue = [...(over.codes ?? [])];
  const stream: Stream = { getTracks: () => [{ stop: () => stopped.push(1) }, { stop: () => stopped.push(2) }] };
  const deps: Deps = {
    secure: true,
    camera: true,
    getStream: async () => (calls.getStream++, stream),
    detector: {
      detect: async () => {
        calls.detect++;
        return (queue.shift() ?? []).map((rawValue) => ({ rawValue }));
      },
    },
    view: { show: () => calls.show++, frame: () => ({}) },
    timer: time.timer,
    ...over,
  };
  delete (deps as { codes?: unknown }).codes;
  return { deps, time, stopped, calls, stream };
};

const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
};

test("only an ISBN-13 with the 978 or 979 prefix and a valid check digit is accepted from a barcode", () => {
  assert.equal(accept([LASKAR]), LASKAR);
  assert.equal(accept(["9791234567896"]), "9791234567896");
  for (const bad of ["9771234567003", "9701234567895", "9501234567891", "9601234567898", "9123456789013", "9789793062793", "0156012197", "0123456789012", "9780156012190", "978979306279", "97897930627921", "978979306279X", " 9789793062792", "9789793062792 ", "ISBN 9789793062792", "978-979-3062-79-2", "", "1234567890128"])
    assert.equal(accept([bad]), null, bad);
  assert.equal(accept([]), null);
});

test("the first valid code among several is taken, and the others are ignored", () => {
  assert.equal(accept(["", "5012345678900", LASKAR, PRINCE]), LASKAR);
  assert.equal(accept(["5012345678900", "123"]), null);
});

test("an ISBN is fresh when it is not already the one in the field, however the field is written", () => {
  assert.equal(fresh("", LASKAR), true);
  assert.equal(fresh(PRINCE, LASKAR), true);
  assert.equal(fresh("12345", LASKAR), true);
  assert.equal(fresh(LASKAR, LASKAR), false);
  assert.equal(fresh(" 978-979-3062-79-2 ", LASKAR), false);
  assert.equal(fresh("ISBN 9789793062792", LASKAR), false);
});

test("a refused camera is told apart: permission, no camera, camera busy, and anything else", () => {
  const named = (name: string) => Object.assign(new Error("x"), { name });
  assert.equal(refusal(named("NotAllowedError")), "denied");
  assert.equal(refusal(named("SecurityError")), "denied");
  assert.equal(refusal(named("NotFoundError")), "none");
  assert.equal(refusal(named("OverconstrainedError")), "none");
  assert.equal(refusal(named("NotReadableError")), "busy");
  assert.equal(refusal(named("AbortError")), "busy");
  assert.equal(refusal(named("TypeError")), "failed");
  assert.equal(refusal("denied"), "failed");
  assert.equal(refusal(null), "failed");
});

test("the loop looks about five times a second, and the minute is the limit", () => {
  assert.equal(INTERVAL, 200);
  assert.equal(LIMIT, 60_000);
});

test("a good code ends the scan: the camera stops, the timers go, and nothing looks again", async () => {
  const { deps, time, stopped, calls } = rig({ codes: [[], ["5012345678900"], [LASKAR]] });
  const session = scan(deps);
  await settle();
  assert.equal(calls.show, 1);
  assert.equal(time.pending(), 2);
  await time.advance(INTERVAL * 3);
  assert.deepEqual(await session.result, { kind: "found", isbn: LASKAR });
  assert.equal(calls.detect, 3);
  assert.deepEqual(stopped, [1, 2]);
  assert.equal(time.pending(), 0);
  await time.advance(LIMIT);
  assert.equal(calls.detect, 3);
});

test("a bad check digit or a code of another kind is never accepted and the scan goes on", async () => {
  const { deps, time, stopped } = rig({ codes: [["9789793062793"], ["0156012197"], ["abc", undefined]] });
  const session = scan(deps);
  await settle();
  await time.advance(INTERVAL * 3);
  assert.deepEqual(stopped, []);
  assert.equal(time.pending(), 2);
  session.stop();
  assert.deepEqual(await session.result, { kind: "closed" });
});

test("after a minute without a barcode the scan says so and the camera stops", async () => {
  const { deps, time, stopped, calls } = rig();
  const session = scan(deps);
  await settle();
  await time.advance(LIMIT - 1);
  assert.deepEqual(stopped, []);
  await time.advance(1);
  assert.deepEqual(await session.result, { kind: "slow" });
  assert.deepEqual(stopped, [1, 2]);
  assert.equal(time.pending(), 0);
  const seen = calls.detect;
  await time.advance(INTERVAL * 5);
  assert.equal(calls.detect, seen);
});

test("closing stops every track once, and a second close or a late result changes nothing", async () => {
  const { deps, time, stopped } = rig({ codes: [[LASKAR]] });
  const session = scan(deps);
  await settle();
  session.stop();
  session.stop();
  assert.deepEqual(await session.result, { kind: "closed" });
  assert.deepEqual(stopped, [1, 2]);
  assert.equal(time.pending(), 0);
  await time.advance(INTERVAL);
  assert.deepEqual(stopped, [1, 2]);
});

test("a camera that arrives after the dialog closed is stopped at once and never shown", async () => {
  let arrive!: (stream: Stream) => void;
  const late = new Promise<Stream>((resolve) => (arrive = resolve));
  const { deps, stopped, calls, time, stream } = rig({ getStream: () => late });
  const session = scan(deps);
  await settle();
  session.stop();
  assert.deepEqual(stopped, []);
  arrive(stream);
  await settle();
  assert.deepEqual(stopped, [1, 2]);
  assert.equal(calls.show, 0);
  assert.equal(time.pending(), 0);
});

test("each refusal is its own plain outcome and no camera is left running", async () => {
  for (const [name, kind] of [["NotAllowedError", "denied"], ["NotFoundError", "none"], ["NotReadableError", "busy"], ["TypeError", "failed"]] as const) {
    const { deps, stopped, time } = rig({ getStream: () => Promise.reject(Object.assign(new Error("x"), { name })) });
    assert.deepEqual(await scan(deps).result, { kind }, name);
    assert.deepEqual(stopped, []);
    assert.equal(time.pending(), 0);
  }
  const { deps } = rig({
    getStream: () => {
      throw new Error("sync");
    },
  });
  assert.deepEqual(await scan(deps).result, { kind: "failed" });
});

test("an insecure page or a browser with no camera API is told so without asking for the camera", async () => {
  const insecure = rig({ secure: false });
  assert.deepEqual(await scan(insecure.deps).result, { kind: "insecure" });
  const none = rig({ camera: false });
  assert.deepEqual(await scan(none.deps).result, { kind: "unsupported" });
  const both = rig({ secure: false, camera: false });
  assert.deepEqual(await scan(both.deps).result, { kind: "insecure" });
  for (const one of [insecure, none, both]) assert.equal(one.calls.getStream, 0);
});

test("a frame is looked at only when the video has one, and a slow look is never overlapped", async () => {
  let ready = false;
  let release!: () => void;
  let slow = false;
  const { deps, time, calls } = rig({
    view: { show: () => {}, frame: () => (ready ? {} : null) },
    detector: {
      detect: async () => {
        calls.detect++;
        if (slow) await new Promise<void>((resolve) => (release = resolve));
        return [];
      },
    },
  });
  const session = scan(deps);
  await settle();
  await time.advance(INTERVAL * 3);
  assert.equal(calls.detect, 0);
  ready = true;
  slow = true;
  await time.advance(INTERVAL * 3);
  assert.equal(calls.detect, 1);
  slow = false;
  release();
  await settle();
  await time.advance(INTERVAL);
  assert.equal(calls.detect, 2);
  session.stop();
});

test("a detector that throws ends the scan as failed and stops the camera", async () => {
  const { deps, stopped, time } = rig({
    detector: {
      detect: async () => {
        throw new Error("boom");
      },
    },
  });
  const session = scan(deps);
  await settle();
  await time.advance(INTERVAL);
  assert.deepEqual(await session.result, { kind: "failed" });
  assert.deepEqual(stopped, [1, 2]);
  assert.equal(time.pending(), 0);
});

test("the real timer runs and cancels", async () => {
  let ticks = 0;
  const off = timer.every(() => ticks++, 5);
  while (ticks < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  off();
  const seen = ticks;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(ticks, seen);
  let fired = 0;
  timer.after(() => fired++, 5);
  timer.after(() => fired++, 5)();
  while (fired < 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(fired, 1);
});

test("the ISBN check is empty, typing, wrong in shape, wrong in its check digit, or valid", () => {
  const table: [string, string, number][] = [
    ["", "empty", 0],
    ["   ", "empty", 0],
    ["isbn", "empty", 0],
    ["ISBN:", "empty", 0],
    ["ISBN-13: ", "empty", 0],
    ["is", "empty", 0],
    ["9", "typing", 1],
    ["978-979", "typing", 6],
    ["080442957", "typing", 9],
    ["9789793062", "typing", 10],
    ["978979306279", "typing", 12],
    ["97897930627", "typing", 11],
    ["9789793062793", "sum", 13],
    ["978-979-3062-79-3", "sum", 13],
    ["080442957Y", "shape", 9],
    ["080442958X", "sum", 9],
    ["97897930627921", "shape", 14],
    ["12X", "shape", 2],
    ["abc", "shape", 0],
    ["9789793062792x", "shape", 13],
    ["978.979.3062.79.2", "shape", 13],
    ["9789793062792", "valid", 13],
    ["0156012197", "valid", 10],
    ["080442957X", "valid", 9],
    ["isbn 978–979–3062–79–2", "valid", 13],
    ["ISBN-10: 0-15-601219-7", "valid", 10],
    ["ISBN 978 979 3062 79 2", "valid", 13],
  ];
  for (const [input, state, digits] of table) {
    const got = isbnCheck(input);
    assert.deepEqual([got.state, got.digits], [state, digits], input);
  }
  assert.equal(isbnCheck("0156012197").isbn, PRINCE);
  assert.equal(isbnCheck("ISBN-10: 0-15-601219-7").isbn, PRINCE);
  assert.equal(isbnCheck("080442957X").isbn, "9780804429573");
  assert.equal(isbnCheck(" 978-979-3062-79-2 ").isbn, LASKAR);
  assert.equal(isbnCheck("9789793062793").isbn, null);
});

test("the note under the ISBN field says what is missing in plain words, and the normalised ISBN once it is valid", () => {
  const { sheet } = { sheet: text.books.sheet };
  assert.equal(isbnNote(""), sheet.isbnHint);
  assert.equal(isbnNote("isbn"), sheet.isbnHint);
  assert.equal(isbnNote("9"), "1 digit so far. An ISBN has 10 or 13.");
  assert.equal(isbnNote("97897"), "5 digits so far. An ISBN has 10 or 13.");
  assert.equal(isbnNote("9789793062"), sheet.isbnTen);
  assert.equal(isbnNote("978979306279"), "12 digits so far. An ISBN has 10 or 13.");
  assert.equal(isbnNote("9789793062793"), sheet.isbnSum);
  assert.equal(isbnNote("080442958X"), sheet.isbnSum);
  assert.equal(isbnNote("97897930627921"), sheet.isbnShape);
  assert.equal(isbnNote("0-15-601219-7"), "Valid. Saved as 9780156012195.");
  assert.equal(isbnNote("ISBN 978–979–3062–79–2"), "Valid. Saved as 9789793062792.");
});

test("the typed note is plain text that no keystroke turns into an alert, and only a save attempt shows the error", () => {
  const sheet = read("ui/book-sheet.tsx");
  assert.match(sheet, /const isbnError = !checked\.ok && attempt && isbn\.trim\(\) !== "" \? text\.invalid\.isbn : undefined;/);
  const field = read("ui/field.tsx");
  assert.match(field, /const note = type === "isbn" \? isbnNote\(onChange \? shown : \(typed \?\? shown\)\) : hint;/);
  assert.doesNotMatch(field, /role="alert">\s*\{note\}/);
  assert.doesNotMatch(read("ui/copy-sheet.tsx"), /isbnHint/);
});

test("every scan state has plain words that send the user back to typing, and none is a dead end", () => {
  const words = text.books.scan;
  for (const state of ["denied", "none", "busy", "insecure", "unsupported", "failed"] as const) assert.match(words[state], /Type the ISBN instead\.$/, state);
  assert.equal(words.denied, "Camera is off. Type the ISBN instead.");
  assert.match(words.slow, /type the ISBN\.$/);
  assert.equal(words.scanned(LASKAR), `Scanned ${LASKAR}`);
  assert.match(words.liveText, /Scan Text/);
});

test("the camera opens only inside the dialog, asks for the back camera, reads frames only through detect, and sends nothing anywhere", () => {
  const view = read("ui/scan.tsx");
  assert.equal(view.match(/getUserMedia/g)?.length, 2);
  assert.match(view, /getUserMedia\(\{ video: \{ facingMode: "environment" \} \}\)/);
  assert.match(view, /\{open && <Camera onDone=\{done\} \/>\}/);
  assert.match(view, /<button type="button" className="secondary" data-first onClick=\{cancel\}>/);
  assert.match(view, /\n      window,\n      document,\n/);
  assert.match(view, /frame: \(\) => frameOf\(element\)/);
  assert.match(view, /if \(was\.current && !open\) button\.current\?\.focus\(\);/);
  assert.match(view, /if \(outcome\.kind === "found"\) \{\s*setNote\(WORDS\.scanned\(outcome\.isbn\)\);\s*onIsbn\(outcome\.isbn\);/);
  assert.match(view, /return tip && navigator\.maxTouchPoints > 0 \? <p className="hint">\{WORDS\.liveText\}<\/p> : null;/);
  assert.match(view, /<p className="hint look-note" role="status">/);
  for (const file of ["ui/scan.tsx", "hooks/use-scan.ts", "domain/scan.ts"]) {
    assert.doesNotMatch(read(file), /canvas|toDataURL|toBlob|createImageBitmap|ImageCapture|MediaRecorder|fetch|sendBeacon|XMLHttpRequest|localStorage|indexedDB/i, file);
  }
});

test("the button is offered only where BarcodeDetector exists and reads EAN-13, by feature and never by user agent", () => {
  const hook = read("hooks/use-scan.ts");
  assert.match(hook, /typeof BarcodeDetector === "undefined"/);
  assert.match(hook, /formats\.includes\("ean_13"\),\s*\(\) => false,/);
  assert.match(hook, /new BarcodeDetector\(\{ formats: \["ean_13"\] \}\)/);
  for (const file of ["ui/scan.tsx", "hooks/use-scan.ts", "domain/scan.ts", "ui/book-lookup.tsx"]) assert.doesNotMatch(read(file), /userAgent|platform|vendor/, file);
});

test("both Add sheets and the book detail get the scan: the shared form fills the ISBN and looks it up, the detail fills a missing ISBN", () => {
  const sheet = read("ui/book-sheet.tsx");
  assert.match(sheet, /<ScanIsbn onIsbn=\{scanned\} tip \/>/);
  assert.match(sheet, /if \(!fresh\(typed\.current\.isbn, code\)\) return;/);
  assert.match(sheet, /typed\.current = \{ \.\.\.typed\.current, isbn: code \};\s*setIsbn\(code\);\s*void lookUp\(code, code\);/);
  const detail = read("ui/book-lookup.tsx");
  assert.match(detail, /\{\(isbn === null \|\| kept\) && <ScanIsbn writes onIsbn=\{\(code\) => void onScan\(code\)\} \/>\}/);
  assert.match(detail, /if \(isbn === null && work === null && !can\) return null;/);
  assert.match(detail, /const step = await scanBook\(lookup, code, \(\) => latest\.current\);/);
  assert.match(detail, /if \(next\.kind === "write"\) return write\(code\);/);
  assert.equal(detail.match(/actions\.update\("items", book\.id, \{ data: \{ isbn: code \} \}\)/g)?.length, 1);
  assert.match(detail, /if \(result\.ok\) await run\(code\);/);
  assert.equal(text.books.lookup.replace, "Replace ISBN?");
  assert.equal(text.books.lookup.replaceBody(PRINCE, LASKAR), `Now ${PRINCE}. Scanned ${LASKAR}.`);
  assert.match(read("views/book.tsx"), /<FillBook key=\{book\.id\} book=\{book\} \/>/);
});

test("the Replace step is driven by the pure decisions: a superseded scan is dropped, Keep only dismisses, Replace writes what was decided, Escape from the camera dialog is not for the prompt, and the prompt shows old then scanned", () => {
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /const mine = scans\.current\.begin\(\);\s*setPending\(null\);\s*setFailure\(\[\]\);\s*setState\("busy"\);/);
  assert.match(view, /const next = landing\(scans\.current\.latest\(mine\), step, code, latest\.current\);\s*if \(next\.kind === "drop"\) return;\s*if \(next\.kind === "write"\) return write\(code\);\s*setState\(next\.state\);\s*setPending\(next\.pending\);/);
  assert.match(view, /const \{ write: code, changed \} = decide\(pending, choice, latest\.current\);\s*dismiss\(\);\s*if \(changed\) setState\("changed"\);\s*if \(code !== null\) void write\(code\);/);
  assert.match(view, /<button ref=\{keep\} type="button" className="secondary" onClick=\{\(\) => choose\("keep"\)\}>\s*\{WORDS\.replaceNo\}/);
  assert.match(view, /<button type="button" onClick=\{\(\) => choose\("replace"\)\}>\s*\{WORDS\.replaceYes\}/);
  assert.equal(view.match(/write\(/g)?.length, 2);
  assert.match(view, /const write = async \(code: string\) => \{\s*dismiss\(\);\s*setKept\(true\);\s*const result = await actions\.update\("items", book\.id, \{ data: \{ isbn: code \} \}\);/);
  assert.match(view, /if \(pending !== null\) keep\.current\?\.focus\(\);/);
  assert.match(view, /setPending\(null\);\s*box\.current\?\.querySelector<HTMLElement>\("button:not\(\[disabled\]\)"\)\?\.focus\(\);/);
  assert.match(view, /onKeyDown=\{\(event\) => dismisses\(event\.key, pending !== null, event\.target instanceof Element && event\.target\.closest\("dialog"\) !== null\) && dismiss\(\)\}/);
  assert.match(view, /<p className="hint">\{WORDS\.replaceBody\(pending\.old, pending\.code\)\}<\/p>/);
  assert.match(view, /state === "changed" \? WORDS\.changed/);
  assert.match(view, /const \[state, setState\] = useState<Fill \| "nothing" \| "changed">\("idle"\);/);
  assert.equal(text.books.lookup.changed, "This book changed while you decided. The ISBN was not replaced.");
});

test("a dialog inside a sheet closes alone: the sheet's close handler ignores a close that came from a dialog within it", () => {
  assert.match(read("ui/modal.tsx"), /onClose=\{\(event\) => event\.target === event\.currentTarget && onClose\(\)\}/);
  assert.match(read("ui/add-sheet.tsx"), /onClose=\{\(event\) => \{\s*if \(event\.target !== event\.currentTarget\) return;\s*overlay\.closeAdd\(\);/);
});

const track = () => {
  const one = {
    readyState: "live" as "live" | "ended",
    stop: () => {
      one.readyState = "ended";
    },
  };
  return one;
};

const cam = (over: Partial<Deps> & { codes?: (string | undefined)[][] } = {}) => {
  const time = clock();
  const tracks: ReturnType<typeof track>[] = [];
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const done: unknown[] = [];
  const shown: number[] = [];
  const queue = [...(over.codes ?? [])];
  const deps: Deps = {
    secure: true,
    camera: true,
    getStream: async () => {
      const mine = [track(), track()];
      tracks.push(...mine);
      return { getTracks: () => mine };
    },
    detector: { detect: async () => (queue.shift() ?? []).map((rawValue) => ({ rawValue })) },
    view: { show: () => shown.push(1), frame: () => ({}) },
    timer: time.timer,
    ...over,
  };
  delete (deps as { codes?: unknown }).codes;
  const mount = () => camera(deps, page, doc, (outcome) => done.push(outcome.kind));
  const live = () => tracks.filter((one) => one.readyState === "live").length;
  return { mount, live, tracks, page, doc, done, shown, time };
};

test("every way out of the dialog ends with every camera track stopped: Cancel, Escape, the X, the host sheet closing", async () => {
  for (const way of ["Cancel", "Escape", "the X", "the host sheet closing"]) {
    const one = cam();
    const unmount = one.mount();
    await settle();
    assert.equal(one.tracks.length, 2, way);
    assert.equal(one.live(), 2, way);
    unmount();
    assert.equal(one.live(), 0, way);
    assert.equal(one.time.pending(), 0, way);
  }
});

test("a good scan, a detector error and the minute limit each stop every track by themselves, and report once", async () => {
  const found = cam({ codes: [[LASKAR]] });
  found.mount();
  await settle();
  await found.time.advance(INTERVAL);
  assert.deepEqual(found.done, ["found"]);
  assert.equal(found.live(), 0);

  const broken = cam({
    detector: {
      detect: async () => {
        throw new Error("boom");
      },
    },
  });
  broken.mount();
  await settle();
  await broken.time.advance(INTERVAL);
  assert.deepEqual(broken.done, ["failed"]);
  assert.equal(broken.live(), 0);

  const slow = cam();
  slow.mount();
  await settle();
  await slow.time.advance(LIMIT - 1);
  assert.equal(slow.live(), 2);
  await slow.time.advance(1);
  assert.deepEqual(slow.done, ["slow"]);
  assert.equal(slow.live(), 0);
});

test("a refused or missing camera leaves nothing running and says so once", async () => {
  const denied = cam({ getStream: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) });
  const unmount = denied.mount();
  await settle();
  assert.deepEqual(denied.done, ["denied"]);
  assert.equal(denied.live(), 0);
  unmount();
  assert.deepEqual(denied.done, ["denied"]);
});

test("the host unmounting is silent: the stopped session never reports closed back to the host", async () => {
  const one = cam();
  const unmount = one.mount();
  await settle();
  unmount();
  await settle();
  assert.deepEqual(one.done, []);
});

test("leaving the page or hiding the tab stops the camera and closes the dialog; showing the tab does nothing", async () => {
  const visible = cam();
  visible.mount();
  await settle();
  visible.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(visible.live(), 2);
  assert.deepEqual(visible.done, []);

  const hidden = cam();
  hidden.mount();
  await settle();
  hidden.doc.hidden = true;
  hidden.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(hidden.live(), 0);
  assert.deepEqual(hidden.done, ["closed"]);

  const gone = cam();
  gone.mount();
  await settle();
  gone.page.dispatchEvent(new Event("pagehide"));
  assert.equal(gone.live(), 0);
  assert.deepEqual(gone.done, ["closed"]);
});

test("after the dialog closed no page event reaches the host", async () => {
  const one = cam();
  const unmount = one.mount();
  await settle();
  unmount();
  one.doc.hidden = true;
  one.doc.dispatchEvent(new Event("visibilitychange"));
  one.page.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(one.done, []);
});

test("a camera that arrives after the dialog closed is stopped on arrival and never shown", async () => {
  let arrive!: () => void;
  const gate = new Promise<void>((resolve) => (arrive = resolve));
  const mine = [track(), track()];
  const one = cam({
    getStream: async () => {
      await gate;
      return { getTracks: () => mine };
    },
  });
  const unmount = one.mount();
  await settle();
  unmount();
  assert.deepEqual(mine.map((each) => each.readyState), ["live", "live"]);
  arrive();
  await settle();
  assert.deepEqual(mine.map((each) => each.readyState), ["ended", "ended"]);
  assert.deepEqual(one.shown, []);
});

test("two starts in a row and React's double mount leave no stream running once both are closed, and the first never closes the second", async () => {
  const twice = cam();
  const first = twice.mount();
  const second = twice.mount();
  await settle();
  first();
  second();
  await settle();
  assert.equal(twice.live(), 0);
  assert.deepEqual(twice.done, []);

  const strict = cam();
  const early = strict.mount();
  early();
  const kept = strict.mount();
  await settle();
  assert.deepEqual(strict.done, []);
  assert.equal(strict.live(), 2);
  assert.equal(strict.shown.length, 1);
  kept();
  assert.equal(strict.live(), 0);
  assert.equal(strict.time.pending(), 0);
});

test("a frame is offered only once the video has data and a size", () => {
  const video = (readyState: number, videoWidth: number) => ({ readyState, videoWidth });
  assert.equal(frameOf(video(0, 0)), null);
  assert.equal(frameOf(video(1, 640)), null);
  assert.equal(frameOf(video(2, 0)), null);
  assert.equal(frameOf(video(4, 0)), null);
  const ready = video(2, 640);
  assert.equal(frameOf(ready), ready);
  const full = video(4, 640);
  assert.equal(frameOf(full), full);
});
