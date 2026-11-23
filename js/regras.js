// Regras de negócio do front-end (sem DOM), usadas no modo demonstração e na interface.
// Os valores ficam em centavos, assim como no back-end.

export function paraCentavos(valor) {
  let texto = String(valor ?? "").replace("R$", "").trim();
  if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, ""); // "20.000" = vinte mil
  const numero = Number(texto);
  if (!texto || !Number.isFinite(numero)) throw new Error("Informe um valor numérico.");
  return Math.round(numero * 100);
}

export function formatarMoeda(centavos) {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function mesAtual(hoje = new Date()) {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export function mesesAnteriores(mes, quantidade) {
  let [ano, m] = mes.split("-").map(Number);
  const meses = [];
  for (let i = 0; i < quantidade; i++) {
    meses.unshift(`${ano}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { ano -= 1; m = 12; }
  }
  return meses;
}

export function nomeMes(mes, formato = "short") {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: formato, year: formato === "long" ? "numeric" : undefined })
    .replace(".", "");
}

export function filtrarTransacoes(lista, { mes, tipo, categoria_id, busca } = {}) {
  const termo = (busca || "").trim().toLowerCase();
  return lista
    .filter(t => !mes || t.data.startsWith(mes))
    .filter(t => !tipo || t.tipo === tipo)
    .filter(t => !categoria_id || t.categoria_id === Number(categoria_id))
    .filter(t => !termo || t.descricao.toLowerCase().includes(termo))
    .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
}

// Mesmo formato de resposta do endpoint GET /api/resumo.
export function calcularResumo(transacoes, categorias, mes) {
  const doMes = transacoes.filter(t => t.data.startsWith(mes));
  const soma = tipo => doMes.filter(t => t.tipo === tipo).reduce((s, t) => s + t.valor_centavos, 0);
  const receitas = soma("receita");
  const despesas = soma("despesa");

  const porCategoria = new Map();
  doMes.filter(t => t.tipo === "despesa").forEach(t => {
    porCategoria.set(t.categoria_id, (porCategoria.get(t.categoria_id) || 0) + t.valor_centavos);
  });

  return {
    mes,
    receitas_centavos: receitas,
    despesas_centavos: despesas,
    saldo_centavos: receitas - despesas,
    taxa_economia: receitas ? Math.round(((receitas - despesas) / receitas) * 10000) / 10000 : 0,
    por_categoria: [...porCategoria.entries()]
      .map(([id, total]) => {
        const c = categorias.find(x => x.id === id) || { nome: "?", cor: "#64748b" };
        return { categoria: c.nome, cor: c.cor, total_centavos: total };
      })
      .sort((a, b) => b.total_centavos - a.total_centavos),
    evolucao: mesesAnteriores(mes, 6).map(m => {
      const lista = transacoes.filter(t => t.data.startsWith(m));
      const total = tipo => lista.filter(t => t.tipo === tipo).reduce((s, t) => s + t.valor_centavos, 0);
      return { mes: m, receitas_centavos: total("receita"), despesas_centavos: total("despesa") };
    })
  };
}

// Quanto falta e quanto guardar por mês para bater a meta no prazo.
export function progressoMeta(meta, hoje = new Date()) {
  const faltam = Math.max(0, meta.alvo_centavos - meta.guardado_centavos);
  const percentual = Math.min(1, meta.guardado_centavos / meta.alvo_centavos);
  let mesesRestantes = null;
  let porMes = null;
  if (meta.prazo && faltam > 0) {
    const [a, m] = meta.prazo.split("-").map(Number);
    mesesRestantes = Math.max(1, (a - hoje.getFullYear()) * 12 + (m - (hoje.getMonth() + 1)) + 1);
    porMes = Math.ceil(faltam / mesesRestantes);
  }
  return { faltam, percentual, mesesRestantes, porMes, concluida: faltam === 0 };
}

export function paraCsv(transacoes) {
  const celula = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [["Data", "Descrição", "Categoria", "Tipo", "Valor"]].concat(
    transacoes.map(t => [
      t.data.split("-").reverse().join("/"),
      t.descricao,
      t.categoria,
      t.tipo === "receita" ? "Receita" : "Despesa",
      ((t.tipo === "receita" ? 1 : -1) * t.valor_centavos / 100).toFixed(2).replace(".", ",")
    ])
  );
  return "\ufeff" + linhas.map(l => l.map(celula).join(";")).join("\n");
}
