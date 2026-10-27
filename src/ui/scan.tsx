import { useEffect, useRef, useState } from "react";
import { camera, frameOf, timer } from "../domain/scan.ts";
import type { Scanned } from "../domain/scan.ts";
import { newDetector, useCanScan } from "../hooks/use-scan.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { text } from "./text.ts";

const WORDS = text.books.scan;

function Camera({ onDone }: { onDone: (outcome: Scanned) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const element = video.current!;
    return camera(
      {
        secure: isSecureContext,
        camera: navigator.mediaDevices?.getUserMedia !== undefined,
        getStream: () => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }),
        detector: newDetector(),
        view: {
          show: (stream) => {
            element.srcObject = stream as MediaStream;
            void element.play().catch(() => {});
          },
          frame: () => frameOf(element),
        },
        timer,
      },
      window,
      document,
      (outcome) => done.current(outcome),
    );
  }, []);

  const cancel = () => done.current({ kind: "closed" });
  return (
    <Modal
      title={WORDS.title}
      onClose={cancel}
      foot={
        <button type="button" className="secondary" data-first onClick={cancel}>
          {WORDS.cancel}
        </button>
      }
    >
      <video ref={video} className="scan-view" aria-label={WORDS.preview} autoPlay muted playsInline />
      <p className="hint" role="status">
        {WORDS.look}
      </p>
    </Modal>
  );
}

export function ScanIsbn({ onIsbn, tip, writes }: { onIsbn: (isbn: string) => void; tip?: true; writes?: true }) {
  const can = useCanScan();
  const { locked, hold } = useWriteLock();
  const held = writes && locked;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const was = useRef(false);

  useEffect(() => {
    if (was.current && !open) button.current?.focus();
    was.current = open;
  }, [open]);

  if (can === null) return null;
  if (!can) return tip && navigator.maxTouchPoints > 0 ? <p className="hint">{WORDS.liveText}</p> : null;

  const done = (outcome: Scanned) => {
    setOpen(false);
    if (outcome.kind === "found") {
      setNote(WORDS.scanned(outcome.isbn));
      onIsbn(outcome.isbn);
    } else if (outcome.kind !== "closed") setNote(WORDS[outcome.kind]);
  };

  return (
    <div className="fill">
      <button
        ref={button}
        type="button"
        className="secondary"
        aria-disabled={held || undefined}
        onClick={() => {
          if (held) return hold();
          setNote("");
          setOpen(true);
        }}
      >
        <Icon name="scan" />
        {WORDS.button}
      </button>
      <p className="hint look-note" role="status">
        {note}
      </p>
      {open && <Camera onDone={done} />}
    </div>
  );
}
