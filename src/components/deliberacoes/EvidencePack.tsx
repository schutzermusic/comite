'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
    FileText,
    Link as LinkIcon,
    File,
    CheckCircle,
    AlertCircle,
    XCircle,
    Plus,
    ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Attachment {
    id: string;
    name: string;
    url: string;
    type: 'document' | 'link' | 'other';
}

interface EvidencePackProps {
    attachments?: Attachment[];
    evidenceComplete?: boolean;
    onAddEvidence?: () => void;
}

const getFileIcon = (type: Attachment['type']) => {
    switch (type) {
        case 'document': return FileText;
        case 'link': return LinkIcon;
        default: return File;
    }
};

const getCompletenessInfo = (complete?: boolean, attachCount?: number) => {
    if (complete || (attachCount && attachCount >= 2)) {
        return {
            label: 'Evidências Completas',
            icon: CheckCircle,
            color: '#00FFB4',
            bgColor: 'rgba(0,255,180,0.08)'
        };
    }
    if (attachCount && attachCount > 0) {
        return {
            label: 'Evidências Parciais',
            icon: AlertCircle,
            color: '#FFB04D',
            bgColor: 'rgba(255,176,77,0.08)'
        };
    }
    return {
        label: 'Evidências Pendentes',
        icon: XCircle,
        color: '#FF5860',
        bgColor: 'rgba(255,88,96,0.08)'
    };
};

export function EvidencePack({
    attachments = [],
    evidenceComplete,
    onAddEvidence
}: EvidencePackProps) {
    const completeness = getCompletenessInfo(evidenceComplete, attachments.length);
    const CompletenessIcon = completeness.icon;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-[rgba(255,255,255,0.85)] uppercase tracking-wide">
                    Pacote de Evidências
                </h4>
                <div
                    className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium"
                    )}
                    style={{
                        color: completeness.color,
                        backgroundColor: completeness.bgColor
                    }}
                >
                    <CompletenessIcon className="w-3 h-3" />
                    {completeness.label}
                </div>
            </div>

            {attachments.length > 0 ? (
                <div className="space-y-2">
                    {attachments.map((attachment) => {
                        const FileIcon = getFileIcon(attachment.type);
                        return (
                            <a
                                key={attachment.id}
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-2.5 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] transition-all group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-[rgba(0,200,255,0.1)] flex items-center justify-center">
                                    <FileIcon className="w-4 h-4 text-[#00C8FF]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-[rgba(255,255,255,0.92)] truncate group-hover:text-[#00C8FF] transition-colors">
                                        {attachment.name}
                                    </p>
                                    <p className="text-[10px] text-[rgba(255,255,255,0.45)] uppercase">
                                        {attachment.type === 'document' ? 'Documento' : attachment.type === 'link' ? 'Link' : 'Arquivo'}
                                    </p>
                                </div>
                                <ExternalLink className="w-4 h-4 text-[rgba(255,255,255,0.25)] group-hover:text-[#00C8FF] transition-colors" />
                            </a>
                        );
                    })}
                </div>
            ) : (
                <div className="py-6 text-center rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]">
                    <File className="w-8 h-8 mx-auto mb-2 text-[rgba(255,255,255,0.2)]" />
                    <p className="text-xs text-[rgba(255,255,255,0.45)]">
                        Nenhuma evidência anexada
                    </p>
                </div>
            )}

            {onAddEvidence && (
                <Button
                    onClick={onAddEvidence}
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
                >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Adicionar Evidência
                </Button>
            )}
        </div>
    );
}
