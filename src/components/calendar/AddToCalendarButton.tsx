'use client';

import React, { useState } from "react";
import { 
  Calendar, 
  ChevronDown,
  Download,
  ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Meeting } from "@/lib/types";

// Import from local utils file
import {
  generateICSContent,
  downloadICSFile,
  generateGoogleCalendarURL,
  generateOutlookCalendarURL,
  generateOffice365CalendarURL,
  formatMeetingForCalendar
} from "@/components/calendar/calendarUtils";

interface AddToCalendarButtonProps {
    reuniao: Meeting;
    variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    appUrl?: string;
}

export default function AddToCalendarButton({ 
  reuniao, 
  variant = "default",
  size = "default",
  appUrl = ""
}: AddToCalendarButtonProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const handleAddToCalendar = (provider: 'google' | 'outlook' | 'office365' | 'ics') => {
    try {
      const eventData = formatMeetingForCalendar(reuniao, appUrl);

      switch (provider) {
        case 'google':
          const googleUrl = generateGoogleCalendarURL(eventData);
          window.open(googleUrl, '_blank');
          toast({ title: 'Abrindo Google Calendar...' });
          break;

        case 'outlook':
          const outlookUrl = generateOutlookCalendarURL(eventData);
          window.open(outlookUrl, '_blank');
          toast({ title: 'Abrindo Outlook Calendar...' });
          break;

        case 'office365':
          const office365Url = generateOffice365CalendarURL(eventData);
          window.open(office365Url, '_blank');
          toast({ title: 'Abrindo Office 365 Calendar...' });
          break;

        case 'ics':
          const icsContent = generateICSContent({
            ...eventData,
            url: appUrl,
            organizerName: 'Comitê Insight'
          });
          downloadICSFile(icsContent, `reuniao-${reuniao.id || 'evento'}.ics`);
          toast({ title: 'Arquivo .ics baixado! Importe no seu calendário.' });
          break;

        default:
          toast({ title: 'Provedor não suportado', variant: 'destructive' });
      }

      setIsOpen(false);
    } catch (error) {
      console.error('Erro ao adicionar ao calendário:', error);
      toast({ title: 'Erro ao adicionar ao calendário', variant: 'destructive' });
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size}>
          <Calendar className="w-4 h-4 mr-2" />
          Adicionar ao Calendário
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Escolha seu calendário</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={() => handleAddToCalendar('google')}>
          <ExternalLink className="w-4 h-4 mr-2 text-blue-600" />
          <div>
            <p className="font-medium">Google Calendar</p>
            <p className="text-xs text-slate-500">Abrir no navegador</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => handleAddToCalendar('outlook')}>
          <ExternalLink className="w-4 h-4 mr-2 text-blue-700" />
          <div>
            <p className="font-medium">Outlook Calendar</p>
            <p className="text-xs text-slate-500">Outlook.com</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => handleAddToCalendar('office365')}>
          <ExternalLink className="w-4 h-4 mr-2 text-orange-600" />
          <div>
            <p className="font-medium">Office 365</p>
            <p className="text-xs text-slate-500">Outlook empresarial</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => handleAddToCalendar('ics')}>
          <Download className="w-4 h-4 mr-2 text-purple-600" />
          <div>
            <p className="font-medium">Baixar arquivo .ics</p>
            <p className="text-xs text-slate-500">Apple Calendar, etc.</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
