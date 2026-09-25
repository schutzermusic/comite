/**
 * Esqueleto com a FORMA da tela (cabeçalho, trilho do fluxo, fila e coluna
 * lateral) — carregar não é uma página em branco.
 */
export function DashboardSkeleton() {
  return (
    <div className="dv2 dv2-skel" role="status" aria-label="Carregando a situação da empresa…">
      <div className="dv2-skel-head"><i style={{ width: 180, height: 12 }} /><i style={{ width: 320, height: 26 }} /><i style={{ width: 260, height: 12 }} /></div>
      <div className="dv2-skel-flow">{Array.from({ length: 11 }, (_, i) => <i key={i} />)}</div>
      <div className="dv2-skel-main">
        <div className="dv2-skel-feed">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</div>
        <div className="dv2-skel-side"><i /><i /></div>
      </div>
    </div>
  );
}
