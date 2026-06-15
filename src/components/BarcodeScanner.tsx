import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onDetected: (isbn: string) => void;
  onCancel: () => void;
}

function normalizeIsbn(raw: string): string | null {
  const digits = raw.replace(/[^0-9Xx]/g, "");
  if (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979"))) return digits;
  if (digits.length === 10) return digits;
  return null;
}

export function BarcodeScanner({ onDetected, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);
    const reader = new BrowserMultiFormatReader(hints);

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const back =
          devices.find((d) => /back|rear|environment/i.test(d.label))?.deviceId ??
          devices[0]?.deviceId;
        if (!videoRef.current) return;
        const controls = await reader.decodeFromVideoDevice(
          back,
          videoRef.current,
          (result) => {
            if (cancelled || !result) return;
            const isbn = normalizeIsbn(result.getText());
            if (!isbn) return;
            controls.stop();
            onDetected(isbn);
          },
        );
        controlsRef.current = controls;
        if (!cancelled) setStarting(false);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not access the camera. Check browser permissions.",
        );
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [onDetected]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-md overflow-hidden bg-black aspect-video">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-3/4 h-16 border-2 border-primary/70 rounded-md" />
        </div>
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting camera…
          </div>
        )}
      </div>
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Camera className="h-3 w-3" /> Hold the back-cover ISBN barcode steady inside the frame.
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={onCancel}>
          <X className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}
