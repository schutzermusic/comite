'use client';

import { useState } from "react";
import { OrgMember } from "@/lib/types";
import {
  Users,
  Building2,
  UserCheck,
  TrendingUp,
  Network,
} from "lucide-react";
import { OrgTreeViewer, departmentColors } from "@/components/orgchart/org-tree-viewer";

import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudFilterBar,
  HudPanel,
  type KpiItem,
  type FilterGroup,
} from "@/components/hud";

const mockOrgMembers: OrgMember[] = [
  { id: 'sergio-fagundes', name: 'Sergio Fagundes', role: 'CEO', department: 'Diretoria', email: 'sergio.fagundes@insight.com' },
  { id: 'ricardo-cruz', name: 'Ricardo Cruz', role: 'CFO', department: 'Diretoria', email: 'ricardo.cruz@insight.com', managerId: 'sergio-fagundes' },
  { id: 'mauricio-souza', name: 'Mauricio Souza', role: 'COO', department: 'Diretoria', email: 'mauricio.souza@insight.com', managerId: 'ricardo-cruz' },
  { id: 'gerencia-comercial', name: 'Vaga Gerente Comercial', role: 'Gerência Comercial', department: 'Comercial', email: 'comercial@insight.com', managerId: 'ricardo-cruz' },
  { id: 'amanda-santos', name: 'Amanda Santos', role: 'Assistente Comercial', department: 'Comercial', email: 'amanda.santos@insight.com', managerId: 'gerencia-comercial' },
  { id: 'sara-oliveira', name: 'Sara de Oliveira', role: 'Assistente', department: 'Comercial', email: 'sara.oliveira@insight.com', managerId: 'gerencia-comercial' },
  { id: 'fefa-medina', name: 'Fefa Medina', role: 'Analista Comercial', department: 'Comercial', email: 'fefa.medina@insight.com', managerId: 'gerencia-comercial' },
  { id: 'beatriz-monteiro', name: 'Beatriz Monteiro', role: 'Vendas Internas', department: 'Comercial', email: 'beatriz.monteiro@insight.com', managerId: 'gerencia-comercial' },
  { id: 'carregamento', name: 'Carregamento', role: 'Coordenação', department: 'Operações', email: 'carregamento@insight.com', managerId: 'mauricio-souza' },
  { id: 'layout', name: 'Layout', role: 'Coordenação', department: 'Operações', email: 'layout@insight.com', managerId: 'mauricio-souza' },
  { id: 'seguranca-patrimonial', name: 'Segurança Patrimonial', role: 'Coordenador', department: 'Segurança Patrimonial', email: 'seguranca@insight.com', managerId: 'mauricio-souza' },
  { id: 'roberto-barana', name: 'Roberto Barana', role: 'Supervisor', department: 'Segurança Patrimonial', email: 'roberto.barana@insight.com', managerId: 'seguranca-patrimonial' },
  { id: 'robson-lima', name: 'Robson Lima', role: 'Vigilante', department: 'Segurança Patrimonial', email: 'robson.lima@insight.com', managerId: 'seguranca-patrimonial' },
  { id: 'ms-seguranca', name: 'MS Segurança CITY', role: 'Terceiro', department: 'Segurança Patrimonial', email: 'ms.seguranca@insight.com', managerId: 'seguranca-patrimonial' },
  { id: 'zeladoria', name: 'Zeladoria', role: 'Coordenação', department: 'Zeladoria', email: 'zeladoria@insight.com', managerId: 'mauricio-souza' },
  { id: 'eliane-bogo', name: 'Eliane Bogo', role: 'Aux. Zeladora', department: 'Zeladoria', email: 'eliane.bogo@insight.com', managerId: 'zeladoria' },
  { id: 'aparecido-santos', name: 'Aparecido dos Santos', role: 'Zelador', department: 'Zeladoria', email: 'aparecido.santos@insight.com', managerId: 'zeladoria' },
  { id: 'mauraina-santos', name: 'Mauraina dos Santos', role: 'Aux. Zeladora', department: 'Zeladoria', email: 'mauraina.santos@insight.com', managerId: 'zeladoria' },
  { id: 'vaga-zeladora', name: 'Vaga', role: 'Zeladora', department: 'Zeladoria', email: 'vaga.zeladora@insight.com', managerId: 'zeladoria' },
  { id: 'manutencao-industrial', name: 'Manutenção Industrial', role: 'Supervisor', department: 'Manutenção Industrial', email: 'manutencao@insight.com', managerId: 'mauricio-souza' },
  { id: 'bruno-tasso', name: 'Bruno Tasso', role: 'Manutenção Pesada', department: 'Manutenção Industrial', email: 'bruno.tasso@insight.com', managerId: 'manutencao-industrial' },
  { id: 'jose-leonardo', name: 'José Leonardo', role: 'Mecânico Montador', department: 'Manutenção Industrial', email: 'jose.leonardo@insight.com', managerId: 'manutencao-industrial' },
  { id: 'vaga-manutencao', name: 'Vaga', role: 'Mecânico Montador', department: 'Manutenção Industrial', email: 'vaga.manutencao@insight.com', managerId: 'manutencao-industrial' },
  { id: 'almoxarifado', name: 'Almoxarifado', role: 'Coordenação', department: 'Almoxarifado', email: 'almoxarifado@insight.com', managerId: 'mauricio-souza' },
  { id: 'cristian-lima', name: 'Cristian Lima', role: 'Auxiliar Almox.', department: 'Almoxarifado', email: 'cristian.lima@insight.com', managerId: 'almoxarifado' },
  { id: 'edson-ferreira', name: 'Edson Ferreira', role: 'Almoxarife', department: 'Almoxarifado', email: 'edson.ferreira@insight.com', managerId: 'almoxarifado' },
  { id: 'vaga-almox', name: 'Vaga', role: 'Auxiliar', department: 'Almoxarifado', email: 'vaga.almox@insight.com', managerId: 'almoxarifado' },
  { id: 'pcp', name: 'Planejamento & PCP', role: 'Coordenação', department: 'Planejamento & PCP', email: 'pcp@insight.com', managerId: 'mauricio-souza' },
  { id: 'cristian-silva', name: 'Cristian Silva', role: 'Coordenador PCP', department: 'Planejamento & PCP', email: 'cristian.silva@insight.com', managerId: 'pcp' },
  { id: 'beatriz-paula', name: 'Beatriz de Paula', role: 'Administrativo', department: 'Planejamento & PCP', email: 'beatriz.paula@insight.com', managerId: 'pcp' },
  { id: 'marcio-santos', name: 'Marcio Santos', role: 'Processos', department: 'Controle de Qualidade', email: 'marcio.santos@insight.com', managerId: 'pcp' },
  { id: 'controle-qualidade', name: 'Controle de Qualidade', role: 'Coordenação', department: 'Controle de Qualidade', email: 'qualidade@insight.com', managerId: 'mauricio-souza' },
  { id: 'vaga-inspetor', name: 'Vaga', role: 'Inspetor de Qualidade', department: 'Controle de Qualidade', email: 'inspetor.qualidade@insight.com', managerId: 'controle-qualidade' },
  { id: 'processos-montagem', name: 'Marcio Santos', role: 'Processos', department: 'Controle de Qualidade', email: 'processos@insight.com', managerId: 'controle-qualidade' },
  { id: 'anderson-silva', name: 'Anderson Silva', role: 'Máquinas e Ferramentas', department: 'Máquinas e Ferramentas', email: 'anderson.silva@insight.com', managerId: 'mauricio-souza' },
  { id: 'caldeiraria', name: 'Caldeiraria/Solda', role: 'Líder', department: 'Caldeiraria/Solda', email: 'caldeiraria@insight.com', managerId: 'anderson-silva' },
  { id: 'esdras-augusto', name: 'Esdras Augusto', role: 'Mecânico Montador', department: 'Caldeiraria/Solda', email: 'esdras.augusto@insight.com', managerId: 'caldeiraria' },
  { id: 'vaga-caldeiraria', name: 'Vaga', role: 'Mecânico Montador/Eletricista', department: 'Caldeiraria/Solda', email: 'vaga.caldeiraria@insight.com', managerId: 'caldeiraria' },
  { id: 'ismail-silva', name: 'Ismael da Silva', role: 'Líder Caldeiraria', department: 'Caldeiraria/Solda', email: 'ismail.silva@insight.com', managerId: 'caldeiraria' },
  { id: 'pintura', name: 'Pintura', role: 'Líder', department: 'Pintura', email: 'pintura@insight.com', managerId: 'anderson-silva' },
  { id: 'brayan-luis', name: 'Brayan Luis', role: 'Pintor', department: 'Pintura', email: 'brayan.luis@insight.com', managerId: 'pintura' },
  { id: 'vaga-pintor', name: 'Vaga', role: 'Pintor', department: 'Pintura', email: 'vaga.pintor@insight.com', managerId: 'pintura' },
  { id: 'montagem', name: 'Montagem & Mecânica', role: 'Líder', department: 'Montagem & Mecânica', email: 'montagem@insight.com', managerId: 'anderson-silva' },
  { id: 'agnaldo-barbaresko', name: 'Agnaldo Barbaresko', role: 'Supervisor', department: 'Montagem & Mecânica', email: 'agnaldo.barbaresko@insight.com', managerId: 'montagem' },
  { id: 'ednilson-correio', name: 'Ednilson Correio', role: 'Mecânico Montador', department: 'Montagem & Mecânica', email: 'ednilson.correio@insight.com', managerId: 'montagem' },
  { id: 'jefferson-rafael', name: 'Jefferson Rafael', role: 'Mecânico Montador', department: 'Montagem & Mecânica', email: 'jefferson.rafael@insight.com', managerId: 'montagem' },
  { id: 'henrique-fernandes', name: 'Henrique Fernandes', role: 'Soldador', department: 'Montagem & Mecânica', email: 'henrique.fernandes@insight.com', managerId: 'montagem' },
  { id: 'anderson-godoy', name: 'Anderson Godoy', role: 'Soldador', department: 'Montagem & Mecânica', email: 'anderson.godoy@insight.com', managerId: 'montagem' },
  { id: 'alisson-rocha', name: 'Alisson Rocha', role: 'Mecânico Montador', department: 'Montagem & Mecânica', email: 'alisson.rocha@insight.com', managerId: 'montagem' },
  { id: 'rodrigo-fonske', name: 'Rodrigo Fonske', role: 'Mecânico Montador', department: 'Montagem & Mecânica', email: 'rodrigo.fonske@insight.com', managerId: 'montagem' },
  { id: 'antonia-silva', name: 'Antonia da Silva', role: 'Soldador', department: 'Montagem & Mecânica', email: 'antonia.silva@insight.com', managerId: 'montagem' },
  { id: 'usinagem', name: 'Usinagem', role: 'Líder', department: 'Usinagem', email: 'usinagem@insight.com', managerId: 'anderson-silva' },
  { id: 'wagner-silva', name: 'Wagner da Silva', role: 'Torneiro', department: 'Usinagem', email: 'wagner.silva@insight.com', managerId: 'usinagem' },
  { id: 'marcelo-trivelin', name: 'Marcelo Trivelin', role: 'Torneiro', department: 'Usinagem', email: 'marcelo.trivelin@insight.com', managerId: 'usinagem' },
  { id: 'denis-henrique', name: 'Denis Henrique', role: 'Torneiro', department: 'Usinagem', email: 'denis.henrique@insight.com', managerId: 'usinagem' },
  { id: 'andre-adame', name: 'Andre Adame', role: 'Aux. Eletricista', department: 'Usinagem', email: 'andre.adame@insight.com', managerId: 'usinagem' },
  { id: 'bruno-rodrigues', name: 'Bruno Rodrigues', role: 'CFO', department: 'Diretoria', email: 'bruno.rodrigues@insight.com', managerId: 'sergio-fagundes' },
  { id: 'juridico', name: 'Vaga Jurídico', role: 'Advogado', department: 'Jurídico', email: 'juridico@insight.com', managerId: 'bruno-rodrigues' },
  { id: 'logistica', name: 'Sergio Junior', role: 'Líder Logística', department: 'Logística', email: 'sergio.junior@insight.com', managerId: 'bruno-rodrigues' },
  { id: 'israel-silveira', name: 'Israel Silveira', role: 'Logística', department: 'Logística', email: 'israel.silveira@insight.com', managerId: 'logistica' },
  { id: 'administrativo', name: 'Administrativo', role: 'Coordenação', department: 'Administrativo', email: 'administrativo@insight.com', managerId: 'bruno-rodrigues' },
  { id: 'suprimentos', name: 'Suprimentos', role: 'Compras', department: 'Suprimentos', email: 'suprimentos@insight.com', managerId: 'administrativo' },
  { id: 'fabio-pereira', name: 'Fabio Pereira', role: 'Comprador', department: 'Suprimentos', email: 'fabio.pereira@insight.com', managerId: 'suprimentos' },
  { id: 'peter-kerton', name: 'Peter Kerton', role: 'Comprador', department: 'Suprimentos', email: 'peter.kerton@insight.com', managerId: 'suprimentos' },
  { id: 'financeiro', name: 'Financeiro', role: 'Coordenação', department: 'Financeiro', email: 'financeiro@insight.com', managerId: 'administrativo' },
  { id: 'anderson-luvaredo', name: 'Anderson Luvaredo', role: 'Tesouraria', department: 'Financeiro', email: 'anderson.luvaredo@insight.com', managerId: 'financeiro' },
  { id: 'diogo-taranto', name: 'Diogo Taranto', role: 'Financeiro', department: 'Financeiro', email: 'diogo.taranto@insight.com', managerId: 'financeiro' },
  { id: 'vanessa-fiscal', name: 'Vanessa', role: 'Fiscal', department: 'Financeiro', email: 'vanessa.fiscal@insight.com', managerId: 'financeiro' },
  { id: 'davi-ferreira', name: 'Davi Ferreira', role: 'Assistente Financeiro', department: 'Financeiro', email: 'davi.ferreira@insight.com', managerId: 'financeiro' },
  { id: 'naily-nogue', name: 'Naily Nogue', role: 'Assistente', department: 'Financeiro', email: 'naily.nogue@insight.com', managerId: 'financeiro' },
  { id: 'contabil', name: 'Contábil', role: 'Coordenação', department: 'Contábil', email: 'contabil@insight.com', managerId: 'administrativo' },
  { id: 'joao-vitor', name: 'João Vitor', role: 'Contador', department: 'Contábil', email: 'joao.vitor@insight.com', managerId: 'contabil' },
  { id: 'rafaela-santos', name: 'Rafaela Santos', role: 'Fiscal', department: 'Contábil', email: 'rafaela.santos@insight.com', managerId: 'contabil' },
  { id: 'recursos-humanos', name: 'Kellely Martins', role: 'Gerente de RH', department: 'Recursos Humanos', email: 'kellely.martins@insight.com', managerId: 'administrativo' },
  { id: 'karina-freitas', name: 'Karina Freitas', role: 'Treinamento & Desenvolvimento', department: 'Recursos Humanos', email: 'karina.freitas@insight.com', managerId: 'recursos-humanos' },
  { id: 'edson-fernando', name: 'Edson Fernando', role: 'Recrutamento e Seleção', department: 'Recursos Humanos', email: 'edson.fernando@insight.com', managerId: 'recursos-humanos' },
  { id: 'duda-ferreira', name: 'Duda Ferreira', role: 'Segurança do Trabalho', department: 'Recursos Humanos', email: 'duda.ferreira@insight.com', managerId: 'recursos-humanos' },
  { id: 'cipa', name: 'CIPA', role: 'Comissão', department: 'CIPA', email: 'cipa@insight.com', managerId: 'recursos-humanos' },
  { id: 'cristina-silva', name: 'Cristina Silva', role: 'Vice-Presidente', department: 'CIPA', email: 'cristina.silva@insight.com', managerId: 'cipa' },
  { id: 'bruno-rami', name: 'Bruno Rami', role: 'Eletricista', department: 'CIPA', email: 'bruno.rami@insight.com', managerId: 'cipa' },
  { id: 'emerson-augusto', name: 'Emerson Augusto', role: 'Eletricista', department: 'CIPA', email: 'emerson.augusto@insight.com', managerId: 'cipa' },
  { id: 'rafael-darlo', name: 'Rafael Darlo', role: 'Técnico', department: 'CIPA', email: 'rafael.darlo@insight.com', managerId: 'cipa' },
  { id: 'wagner-amor', name: 'Wagner Amor', role: 'Operador', department: 'CIPA', email: 'wagner.amor@insight.com', managerId: 'cipa' },
  { id: 'felipe-giambarredi', name: 'Felipe Giambarredi', role: 'Engenharia Elétrica', department: 'Engenharia Elétrica', email: 'felipe.giambarredi@insight.com', managerId: 'sergio-fagundes' },
  { id: 'isolacao', name: 'Isolação', role: 'Coordenação', department: 'Isolação', email: 'isolacao@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'cassiana-souza', name: 'Cassiana de Souza', role: 'Líder Isolação', department: 'Isolação', email: 'cassiana.souza@insight.com', managerId: 'isolacao' },
  { id: 'josue-cristian', name: 'Josué Cristian', role: 'Isolador', department: 'Isolação', email: 'josue.cristian@insight.com', managerId: 'isolacao' },
  { id: 'wesley-borges', name: 'Wesley Borges', role: 'Isolador', department: 'Isolação', email: 'wesley.borges@insight.com', managerId: 'isolacao' },
  { id: 'mikael-alves', name: 'Mikael Alves', role: 'Isolador', department: 'Isolação', email: 'mikael.alves@insight.com', managerId: 'isolacao' },
  { id: 'marcela-alves', name: 'Marcela Alves', role: 'Isolador', department: 'Isolação', email: 'marcela.alves@insight.com', managerId: 'isolacao' },
  { id: 'erick-douglas', name: 'Erick Douglas', role: 'Isolador', department: 'Isolação', email: 'erick.douglas@insight.com', managerId: 'isolacao' },
  { id: 'bobinagem', name: 'Bobinagem', role: 'Coordenação', department: 'Bobinagem', email: 'bobinagem@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'valdeci-aparecido', name: 'Valdeci Aparecido', role: 'Bobinador', department: 'Bobinagem', email: 'valdeci.aparecido@insight.com', managerId: 'bobinagem' },
  { id: 'rodolfo-balassoni', name: 'Rodolfo Balassoni', role: 'Bobinador', department: 'Bobinagem', email: 'rodolfo.balassoni@insight.com', managerId: 'bobinagem' },
  { id: 'osimar-pio', name: 'Osimar Pio', role: 'Bobinador', department: 'Bobinagem', email: 'osimar.pio@insight.com', managerId: 'bobinagem' },
  { id: 'paulo-sergio', name: 'Paulo Sérgio', role: 'Bobinador', department: 'Bobinagem', email: 'paulo.sergio@insight.com', managerId: 'bobinagem' },
  { id: 'bruno-pivni', name: 'Bruno Pivni', role: 'Bobinador', department: 'Bobinagem', email: 'bruno.pivni@insight.com', managerId: 'bobinagem' },
  { id: 'daniel-henrique', name: 'Daniel Henrique', role: 'Bobinador', department: 'Bobinagem', email: 'daniel.henrique@insight.com', managerId: 'bobinagem' },
  { id: 'engenharia-eletrica', name: 'Engenharia Elétrica', role: 'Coordenação', department: 'Engenharia Elétrica', email: 'eng.eletrica@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'vaga-assistente-eletrica', name: 'Vaga', role: 'Assistente', department: 'Engenharia Elétrica', email: 'assistente.eletrica@insight.com', managerId: 'engenharia-eletrica' },
  { id: 'murilo-fragines', name: 'Murilo Fragines', role: 'Auxiliar', department: 'Engenharia Elétrica', email: 'murilo.fragines@insight.com', managerId: 'engenharia-eletrica' },
  { id: 'engenharia-mecanica', name: 'Engenharia Mecânica', role: 'Coordenação', department: 'Engenharia Mecânica', email: 'eng.mecanica@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'fabio-ferreira', name: 'Fabio Ferreira', role: 'Engenheiro Mecânico', department: 'Engenharia Mecânica', email: 'fabio.ferreira@insight.com', managerId: 'engenharia-mecanica' },
  { id: 'gabriel-alves', name: 'Gabriel Alves', role: 'Assistente', department: 'Engenharia Mecânica', email: 'gabriel.alves@insight.com', managerId: 'engenharia-mecanica' },
  { id: 'ensaios', name: 'Ensaios', role: 'Gerência', department: 'Ensaios', email: 'ensaios@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'silvio-fagundes', name: 'Silvio Fagundes', role: 'Gerente de Ensaios', department: 'Ensaios', email: 'silvio.fagundes@insight.com', managerId: 'ensaios' },
  { id: 'cristiano-serrano', name: 'Cristiano Serrano', role: 'Técnico Eletrônico', department: 'Ensaios', email: 'cristiano.serrano@insight.com', managerId: 'ensaios' },
  { id: 'erick-campos', name: 'Erick Campos', role: 'Engenheiro de Ensaios', department: 'Ensaios', email: 'erick.campos@insight.com', managerId: 'ensaios' },
  { id: 'kamil-doulah', name: 'Kamil Doulah', role: 'Eletricista', department: 'Ensaios', email: 'kamil.doulah@insight.com', managerId: 'ensaios' },
  { id: 'vaga-eletricista-ensaios', name: 'Vaga', role: 'Eletricista', department: 'Ensaios', email: 'vaga.ensaios@insight.com', managerId: 'ensaios' },
  { id: 'campo', name: 'Campo', role: 'Coordenação', department: 'Campo', email: 'campo@insight.com', managerId: 'felipe-giambarredi' },
  { id: 'turbo-maquinas', name: 'Turbo Máquinas', role: 'Coordenação', department: 'Turbo Máquinas', email: 'turbo.maquinas@insight.com', managerId: 'campo' },
  { id: 'guilherme-campos', name: 'Guilherme Campos', role: 'Engenheiro Mecânico', department: 'Turbo Máquinas', email: 'guilherme.campos@insight.com', managerId: 'turbo-maquinas' },
  { id: 'everson-pereira', name: 'Everson Pereira', role: 'Líder de Mecânica', department: 'Turbo Máquinas', email: 'everson.pereira@insight.com', managerId: 'turbo-maquinas' },
  { id: 'rodrigo-mailer', name: 'Rodrigo Mailer', role: 'Líder Mecânica', department: 'Campo', email: 'rodrigo.mailer@insight.com', managerId: 'campo' },
  { id: 'victor-pereira', name: 'Victor Pereira', role: 'Líder Mecânica', department: 'Campo', email: 'victor.pereira@insight.com', managerId: 'campo' },
  { id: 'antonio-marco', name: 'Antonio Marco', role: 'Técnico Eletromecânico', department: 'Campo', email: 'antonio.marco@insight.com', managerId: 'campo' },
  { id: 'tomas-ramos', name: 'Tomas Ramos', role: 'Aux. Eletricista', department: 'Campo', email: 'tomas.ramos@insight.com', managerId: 'campo' },
  { id: 'daniel-ramos', name: 'Daniel Ramos', role: 'Mecânico', department: 'Campo', email: 'daniel.ramos@insight.com', managerId: 'campo' },
  { id: 'ricardo-caandido', name: 'Ricardo Caandido', role: 'Mecânico Montador', department: 'Campo', email: 'ricardo.caandido@insight.com', managerId: 'campo' },
  { id: 'wesley-filho', name: 'Wesley Filho', role: 'Eletricista', department: 'Campo', email: 'wesley.filho@insight.com', managerId: 'campo' },
  { id: 'jose-henrique', name: 'Jose Henrique', role: 'Mecânico Montador', department: 'Campo', email: 'jose.henrique@insight.com', managerId: 'campo' },
  { id: 'francisco-rocha', name: 'Francisco Rocha', role: 'Mecânico Montador', department: 'Campo', email: 'francisco.rocha@insight.com', managerId: 'campo' },
  { id: 'adrian-junior', name: 'Adrian Junior', role: 'Suporte', department: 'Campo', email: 'adrian.junior@insight.com', managerId: 'campo' },
];

export default function OrganogramaPage() {
  const [members] = useState<OrgMember[]>(mockOrgMembers);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');

  const departments = Array.from(new Set(members.map((m) => m.department)));
  const managers = members.filter((m) => members.some((member) => member.managerId === m.id));
  const avgTeamSize =
    managers.length > 0 ? members.filter((m) => m.managerId).length / managers.length : 0;

  const stats = {
    total: members.length,
    departments: departments.length,
    managers: managers.length,
    avgTeamSize: Math.round(avgTeamSize * 10) / 10,
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDepartment = departmentFilter === 'all' || member.department === departmentFilter;
    return matchesSearch && matchesDepartment;
  });

  const kpiItems: KpiItem[] = [
    { id: 'total', value: stats.total, label: 'Total de Colaboradores', variant: 'info', icon: <Users className="w-5 h-5" /> },
    { id: 'departments', value: stats.departments, label: 'Departamentos', variant: 'default', icon: <Building2 className="w-5 h-5" /> },
    { id: 'managers', value: stats.managers, label: 'Gestores', variant: 'success', icon: <UserCheck className="w-5 h-5" /> },
    { id: 'avgTeam', value: stats.avgTeamSize, label: 'Média por Equipe', variant: 'default', icon: <TrendingUp className="w-5 h-5" /> },
  ];

  const filterGroups: FilterGroup[] = [
    {
      id: 'department',
      label: 'Departamento',
      value: departmentFilter,
      options: departments.map((d) => ({ value: d, label: d })),
      onChange: setDepartmentFilter,
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Organograma"
        subtitle="Visualização hierárquica da estrutura organizacional"
        icon={<Network className="w-5 h-5" />}
        iconTint="#3B82F6"
        breadcrumbs={[{ label: 'Organograma' }]}
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      <HudFilterBar
        searchPlaceholder="Buscar por nome, cargo ou e-mail..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        filterGroups={filterGroups}
      />

      <HudPanel title="Legenda de Departamentos" accentColor="cyan">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {[
            'Diretoria', 'Comercial', 'Operações', 'Máquinas e Ferramentas',
            'Engenharia Elétrica', 'Engenharia Mecânica', 'Ensaios', 'Campo',
            'Recursos Humanos', 'Logística', 'Financeiro', 'CIPA',
          ].map((dept) => (
            <div key={dept} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${departmentColors[dept] || 'bg-slate-200'}`} />
              <span className="text-white/60 text-xs">{dept}</span>
            </div>
          ))}
        </div>
      </HudPanel>

      <HudPanel noPadding>
        <OrgTreeViewer members={filteredMembers} />
      </HudPanel>
    </HudPageLayout>
  );
}
