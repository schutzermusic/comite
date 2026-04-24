"use client";

export function AtmosphericBackground() {
  return (
    <>
      {/* Plano 0: canvas escuro */}
      <div className="fixed inset-0 -z-30 bg-ig-canvas" />

      {/* Plano 1: halo teal no topo */}
      <div
        className="fixed inset-0 -z-29 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(20,184,166,0.07), transparent 60%)',
        }}
      />

      {/* Plano 2: grid isométrico com máscara */}
      <div
        className="fixed inset-0 -z-28 pointer-events-none opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(to right,  rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 80% 100% at 50% 40%, #000 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 100% at 50% 40%, #000 0%, transparent 75%)',
        }}
      />

      {/* Plano 3: aurora em drift */}
      <div className="fixed inset-0 -z-27 pointer-events-none ig-aurora" />

      {/* Plano 4: vinheta inferior */}
      <div
        className="fixed inset-0 -z-26 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(0,0,0,0.55), transparent 70%)',
        }}
      />
    </>
  );
}
