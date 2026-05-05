'use client';

import React from 'react';
import {
    FileText,
    Link as LinkIcon,
    File,
    CheckCircle,
    AlertCircle,
    XCircle,
    Plus,
    ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudButton } from '@/components/hud';

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
        return { label: 'Evidências Completas', icon: CheckCircle, colorClass: 'text-ig-success', bgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)]' };
    }
    if (attachCount && attachCount > 0) {
        return { label: 'Evidências Parciais', icon: AlertCircle, colorClass: 'text-ig-warning', bgClass: 'bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)]' };
    }
    return { label: 'Evidências Pendentes', icon: XCircle, colorClass: 'text-ig-danger', bgClass: 'bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]' };
};

export function EvidencePack({ attachments = [], evidenceComplete, onAddEvidence }: EvidencePackProps) {
    const completeness = getCompletenessInfo(evidenceComplete, attachments.length);
    const CompletenessIcon = completeness.icon;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-ig-fg-strong uppercase tracking-wide">
                    Pacote de Evidências
                </h4>
                <span className={cn(
                    'flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium',
                    completeness.colorClass,
                    completeness.bgClass,
                )}>
                    <CompletenessIcon className="w-3 h-3" />
                    {completeness.label}
                </span>
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
                                className="flex items-center gap-3 p-2.5 rounded-lg bg-ig-panel border border-ig-border hover:border-ig-border-strong hover:bg-ig-panel-hover transition-all group"
                            >
                                <div className="w-8 h-8 rounded-lg bg-ig-accent-weak flex items-center justify-center">
                                    <FileIcon className="w-4 h-4 text-ig-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-ig-fg-strong truncate group-hover:text-ig-accent transition-colors">
                                        {attachment.name}
                                    </p>
                                    <p className="text-[10px] text-ig-fg-subtle uppercase">
                                        {attachment.type === 'document' ? 'Documento' : attachment.type === 'link' ? 'Link' : 'Arquivo'}
                                    </p>
                                </div>
                                <ExternalLink className="w-4 h-4 text-ig-fg-subtle group-hover:text-ig-accent transition-colors" />
                            </a>
                        );
                    })}
                </div>
            ) : (
                <div className="py-6 text-center rounded-lg border border-dashed border-ig-border bg-ig-panel/50">
                    <File className="w-8 h-8 mx-auto mb-2 text-ig-fg-subtle" />
                    <p className="text-xs text-ig-fg-subtle">Nenhuma evidência anexada</p>
                </div>
            )}

            {onAddEvidence && (
                <HudButton
                    variant="ghost"
                    size="sm"
                    fullWidth
                    onClick={onAddEvidence}
                    leftIcon={<Plus className="w-3.5 h-3.5" />}
                    className="border border-dashed border-ig-border"
                >
                    Adicionar Evidência
                </HudButton>
            )}
        </div>
    );
}
