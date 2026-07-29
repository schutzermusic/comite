'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { buildInvestorPackPresentationHtml } from '@/lib/finance/investor-pack/html-presentation';
import { getInvestorPack } from '@/lib/finance/investor-pack/store';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

export default function InvestorPackPresentationPage() {
  const params = useParams<{ id: string }>();
  const [pack, setPack] = useState<InvestorPack | null>(null);
  useEffect(() => { void getInvestorPack(params.id).then(setPack); }, [params.id]);
  const html = useMemo(() => pack ? buildInvestorPackPresentationHtml(pack) : '', [pack]);

  if (!pack) {
    return <div className="fixed inset-0 z-[100] grid place-items-center bg-[#071014] text-sm text-white/60">Carregando apresentação...</div>;
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#071014]">
      <iframe
        title={`Apresentação - ${pack.title}`}
        srcDoc={html}
        allow="fullscreen"
        className="absolute inset-0 h-full w-full border-0"
      />
      <Link
        href={`/financeiro/pack-investidor/${pack.id}`}
        className="fixed left-6 top-5 z-[110] inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-[#071014]/80 px-3 text-xs font-semibold text-white/75 shadow-xl backdrop-blur transition hover:border-[#35e6bb]/60 hover:text-[#35e6bb]"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar ao editor
      </Link>
    </div>
  );
}

