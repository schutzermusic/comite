import Link from "next/link";
import {
  HudCard as Card,
  HudCardContent as CardContent,
  HudCardDescription as CardDescription,
  HudCardHeader as CardHeader,
  HudCardTitle as CardTitle,
  HudHeader,
  HudPageLayout,
} from "@/components/hud";
import {
  HudTableElement as Table,
  HudTableBody as TableBody,
  HudTableCell as TableCell,
  HudTableHead as TableHead,
  HudTableHeader as TableHeader,
  HudTableRow as TableRow,
} from "@/components/hud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { votes } from "@/lib/mock-data";
import { PlusCircle, MoreHorizontal, Vote } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const statusMapping: { [key: string]: { text: string; color: string } } = {
  nao_iniciada: { text: "Não Iniciada", color: "bg-gray-400" },
  em_andamento: { text: "Em Andamento", color: "bg-blue-500" },
  encerrada: { text: "Encerrada", color: "bg-green-700" },
};

export default function VotingsPage() {
  return (
    <HudPageLayout>
      <HudHeader
        title="Votações"
        subtitle="Participe das votações abertas e consulte os resultados."
        icon={<Vote className="w-5 h-5" />}
        breadcrumbs={[{ label: 'Votações' }]}
        actions={
          <Button asChild>
            <Link href="/votacoes/nova">
              <PlusCircle className="mr-2 h-4 w-4" />
              Criar Votação
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Votações Ativas e Encerradas</CardTitle>
          <CardDescription>
            Participe das votações abertas e consulte os resultados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Comitê</TableHead>
                <TableHead>Prazo Final</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {votes.map((vote) => (
                <TableRow key={vote.id}>
                  <TableCell className="font-medium">
                    <Link href={`/votacoes/${vote.id}`} className="hover:underline">
                      {vote.titulo}
                    </Link>
                  </TableCell>
                  <TableCell>{vote.comite}</TableCell>
                  <TableCell>
                    {new Date(vote.prazoFim).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-foreground">
                        <span className={`mr-2 h-2 w-2 rounded-full ${statusMapping[vote.status].color}`}></span>
                        {statusMapping[vote.status].text}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Ações</DropdownMenuLabel>
                        <DropdownMenuItem>Ver Detalhes</DropdownMenuItem>
                        <DropdownMenuItem>Votar</DropdownMenuItem>
                        <DropdownMenuItem>Ver Resultados</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </HudPageLayout>
  );
}
