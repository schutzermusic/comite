'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, CircleAlert } from 'lucide-react';

export interface ToastMsg { id: number; tone: 'ok' | 'warn'; title: string; detail?: string }

/** O toast do protótipo (`.ap-toast`): some sozinho em 4,2 s. */
export function useToast() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const [shown, setShown] = useState(false);
  const seq = useRef(0);
  const show = useCallback((title: string, detail?: string, tone: 'ok' | 'warn' = 'ok') => {
    seq.current += 1;
    setMsg({ id: seq.current, tone, title, detail });
    setShown(true);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setShown(false), 4200);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, shown, show };
}

export function Toast({ msg, shown }: { msg: ToastMsg | null; shown: boolean }): ReactNode {
  return (
    <div className="dg-toast" data-show={shown && msg ? '1' : undefined} role="status" aria-live="polite">
      {msg && (
        <>
          {msg.tone === 'ok' ? <BadgeCheck size={17} aria-hidden className="dg-ico" /> : <CircleAlert size={17} aria-hidden className="dg-ico warn" />}
          <span><b>{msg.title}</b>{msg.detail ? <> · {msg.detail}</> : null}</span>
        </>
      )}
    </div>
  );
}
