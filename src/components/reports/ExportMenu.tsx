'use client';

import React, { useState } from "react";
import { 
  Download, 
  FileText, 
  Table, 
  FileSpreadsheet,
  Code,
  Loader2,
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

interface ExportMenuProps {
  data: any[];
  fileName?: string;
  tipo_relatorio?: string;
  filtros?: Record<string, any>;
}

export default function ExportMenu({ 
  data, 
  fileName = "relatorio",
}: ExportMenuProps) {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<string | null>(null);

  const handleExport = async (formato: string) => {
    setIsExporting(true);
    setExportFormat(formato);

    try {
      // Simulate export delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      switch (formato) {
        case 'csv':
          exportToCSV(data, fileName);
          break;
        case 'json':
          exportToJSON(data, fileName);
          break;
        case 'xlsx':
          toast({ title: 'Exportação XLSX em desenvolvimento', variant: 'default' });
          break;
        case 'pdf':
          toast({ title: 'Exportação PDF em desenvolvimento', variant: 'default' });
          break;
        default:
          throw new Error('Formato não suportado');
      }

      toast({ title: `Relatório exportado como ${formato.toUpperCase()}!`, variant: 'default' });
    } catch (error: any) {
      console.error('Erro ao exportar:', error);
      toast({ title: 'Erro ao exportar relatório', description: error.message, variant: 'destructive' });
    } finally {
      setIsExporting(false);
      setExportFormat(null);
    }
  };

  const exportToCSV = (csvData: any[], csvFileName: string) => {
    if (!Array.isArray(csvData) || csvData.length === 0) {
      toast({ title: 'Nenhum dado para exportar', variant: 'destructive' });
      return;
    }

    const headers = Object.keys(csvData[0]);
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => 
        headers.map(header => {
          const value = row[header];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${csvFileName}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const exportToJSON = (jsonData: any[], jsonFileName: string) => {
    const jsonContent = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${jsonFileName}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exportando...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Escolha o formato</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onClick={() => handleExport('csv')}
          disabled={isExporting}
        >
          <Table className="w-4 h-4 mr-2 text-green-600" />
          <div>
            <p className="font-medium">CSV</p>
            <p className="text-xs text-slate-500">Arquivo de valores separados</p>
          </div>
          {exportFormat === 'csv' && (
            <Loader2 className="w-4 h-4 ml-auto animate-spin text-green-600" />
          )}
        </DropdownMenuItem>

        <DropdownMenuItem 
          onClick={() => handleExport('xlsx')}
          disabled={true} // Not implemented
        >
          <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-600" />
          <div>
            <p className="font-medium">Excel (XLSX)</p>
            <p className="text-xs text-slate-500">Planilha do Excel</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem 
          onClick={() => handleExport('pdf')}
          disabled={true} // Not implemented
        >
          <FileText className="w-4 h-4 mr-2 text-red-600" />
          <div>
            <p className="font-medium">PDF</p>
            <p className="text-xs text-slate-500">Documento formatado</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem 
          onClick={() => handleExport('json')}
          disabled={isExporting}
        >
          <Code className="w-4 h-4 mr-2 text-blue-600" />
          <div>
            <p className="font-medium">JSON</p>
            <p className="text-xs text-slate-500">Dados estruturados</p>
          </div>
          {exportFormat === 'json' && (
            <Loader2 className="w-4 h-4 ml-auto animate-spin text-blue-600" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
