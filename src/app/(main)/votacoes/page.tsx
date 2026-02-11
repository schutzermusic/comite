import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { votes } from "@/lib/mock-data";
import { PlusCircle, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const statusMapping: { [key: string]: { text: string; color: string } } = {
  nao_iniciada: { text: "Não Iniciada", color: "bg-gray-400" },
  em_andamento: { text: "Em Andamento", color: "bg-blue-500" },
  encerrada: { text: "Encerrada", color: "bg-green-700" },
};

export default function VotingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold font-headline">Votações</h1>
        <Button asChild>
          <Link href="/votacoes/nova">
            <PlusCircle className="mr-2 h-4 w-4" />
            Criar Votação
          </Link>
        </Button>
      </div>

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
    </div>
  );
}
