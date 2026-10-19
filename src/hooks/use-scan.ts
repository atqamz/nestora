import { useEffect, useState } from "react";

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(frame: unknown): Promise<{ rawValue?: string }[]>;
}

let support: Promise<boolean> | null = null;

const canScan = () =>
  (support ??= typeof BarcodeDetector === "undefined"
    ? Promise.resolve(false)
    : BarcodeDetector.getSupportedFormats().then(
        (formats) => formats.includes("ean_13"),
        () => false,
      ));

export const useCanScan = (): boolean | null => {
  const [can, setCan] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void canScan().then((yes) => live && setCan(yes));
    return () => {
      live = false;
    };
  }, []);
  return can;
};

export const newDetector = () => new BarcodeDetector({ formats: ["ean_13"] });
