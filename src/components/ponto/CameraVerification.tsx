'use client';

/**
 * Confirmação por selfie (§7).
 *
 * Importante: NÃO é reconhecimento facial. O sistema apenas guarda a foto
 * como evidência de presença (authentication_evidence, method
 * 'facial_verification'), então a interface fala em "confirmação por
 * foto" e não simula nenhuma varredura biométrica. A privacidade, a URL
 * assinada, a retenção e o controle de acesso continuam no servidor.
 */

import * as React from 'react';
import { Camera, CameraOff, Check, Lightbulb, RefreshCw, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PontoButton, Spinner } from './primitives';
import { PontoSheet } from './PontoSheet';

type CameraState = 'starting' | 'live' | 'captured' | 'error';

interface CameraError {
  title: string;
  description: string;
  /** Só quando faz sentido tentar de novo no mesmo aparelho. */
  retryable: boolean;
}

function describeCameraError(error: unknown): CameraError {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Câmera não autorizada',
        description:
          'Abra as configurações do navegador, permita o uso da câmera para este site e tente de novo.',
        retryable: true,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'Nenhuma câmera encontrada',
        description: 'Este aparelho não tem câmera frontal disponível. Fale com seu gestor para registrar de outra forma.',
        retryable: false,
      };
    case 'NotReadableError':
      return {
        title: 'A câmera está ocupada',
        description: 'Feche outros aplicativos que estejam usando a câmera e tente novamente.',
        retryable: true,
      };
    default:
      return {
        title: 'Não foi possível abrir a câmera',
        description:
          error instanceof Error && error.message
            ? error.message
            : 'Verifique as permissões do navegador e tente novamente.',
        retryable: true,
      };
  }
}

export interface CameraVerificationProps {
  open: boolean;
  title: string;
  /** Enviando a foto / registrando o ponto. */
  submitting?: boolean;
  /** Falha no envio — a foto capturada é preservada para reenvio (Fluxo 7). */
  uploadError?: string | null;
  onConfirm: (imageDataUrl: string) => void;
  onCancel: () => void;
}

export function CameraVerification({
  open,
  title,
  submitting = false,
  uploadError,
  onConfirm,
  onCancel,
}: CameraVerificationProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [state, setState] = React.useState<CameraState>('starting');
  const [error, setError] = React.useState<CameraError | null>(null);
  const [shot, setShot] = React.useState<string | null>(null);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = React.useCallback(async () => {
    setError(null);
    setState('starting');
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('Câmera não disponível neste navegador.'), { name: 'NotFoundError' });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState('live');
    } catch (e) {
      setError(describeCameraError(e));
      setState('error');
    }
  }, []);

  // A câmera só liga com a folha aberta — nunca em segundo plano.
  React.useEffect(() => {
    if (!open) {
      stop();
      setShot(null);
      setState('starting');
      setError(null);
      return;
    }
    void start();
    return () => stop();
  }, [open, start, stop]);

  function takeShot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // recorte central quadrado, espelhado (selfie)
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    setShot(canvas.toDataURL('image/jpeg', 0.82));
    setState('captured');
    stop();
  }

  function retake() {
    setShot(null);
    void start();
  }

  const footer = (
    <div className="space-y-2">
      {state === 'error' ? (
        error?.retryable ? (
          <PontoButton variant="primary" icon={RefreshCw} onClick={() => void start()}>
            Tentar novamente
          </PontoButton>
        ) : (
          <PontoButton variant="secondary" onClick={onCancel}>
            Voltar
          </PontoButton>
        )
      ) : state === 'captured' && shot ? (
        <>
          <PontoButton
            variant="primary"
            icon={ShieldCheck}
            loading={submitting}
            onClick={() => onConfirm(shot)}
          >
            {uploadError ? 'Enviar novamente' : 'Usar esta foto e registrar'}
          </PontoButton>
          <PontoButton variant="ghost" icon={RefreshCw} disabled={submitting} onClick={retake}>
            Tirar outra foto
          </PontoButton>
        </>
      ) : (
        <PontoButton
          variant="primary"
          icon={Camera}
          disabled={state !== 'live'}
          onClick={takeShot}
        >
          Tirar foto
        </PontoButton>
      )}
    </div>
  );

  return (
    <PontoSheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onCancel();
      }}
      title={title}
      description="A foto fica anexada à marcação como comprovante de presença."
      footer={footer}
    >
      <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-[var(--ig-radius-xl)] border border-ig-border-strong bg-black">
        {state === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <CameraOff className="h-7 w-7 text-ig-danger" aria-hidden="true" />
            <p className="text-ig-h3 text-ig-fg-strong">{error?.title}</p>
            <p className="text-ig-caption text-ig-fg-muted">{error?.description}</p>
          </div>
        ) : shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="Foto capturada para confirmar a presença" className="h-full w-full object-cover" />
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Pré-visualização da câmera frontal"
              className="h-full w-full -scale-x-100 object-cover"
            />
            {/* Guia de enquadramento — estático, sem simular leitura facial. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="h-[74%] w-[58%] rounded-[50%] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            {state === 'starting' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Spinner className="h-7 w-7 text-white" />
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 space-y-1.5" aria-live="polite">
        {state === 'captured' ? (
          <p className="flex items-center justify-center gap-1.5 text-ig-body-sm text-ig-success">
            <Check className="h-4 w-4" aria-hidden="true" />
            Foto registrada. Confira e confirme.
          </p>
        ) : (
          <ul className="space-y-1 text-ig-caption text-ig-fg-muted">
            <li className="flex items-start gap-1.5">
              <Camera className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Posicione seu rosto dentro da área indicada.
            </li>
            <li className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Mantenha o celular na altura dos olhos.
            </li>
            <li className="flex items-start gap-1.5">
              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Evite ambientes muito escuros.
            </li>
          </ul>
        )}

        {uploadError ? (
          <p role="alert" className={cn('rounded-[var(--ig-radius-sm)] px-3 py-2 text-ig-caption', 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] text-ig-danger')}>
            {uploadError} Sua foto continua aqui — toque em “Enviar novamente”.
          </p>
        ) : null}
      </div>
    </PontoSheet>
  );
}
