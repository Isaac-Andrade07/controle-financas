// Testes do front-end. Rode com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { paraCentavos, mesesAnteriores, calcularResumo, filtrarTransacoes, progressoMeta, paraCsv } from "../js/regras.js";
import { ApiLocal } from "../js/api.js";

function storageFalso() {
  const dados = {};
  return { getItem: k => dados[k] ?? null, setItem: (k, v) => { dados[k] = v; }, removeItem: k => { delete dados[k]; } };
}

test("converte valores digitados para centavos", () => {
  assert.equal(paraCentavos("1.234,56"), 123456);
  assert.equal(paraCentavos("R$ 49,90"), 4990);
  assert.equal(paraCentavos(10.1), 1010);
  assert.equal(paraCentavos("20.000"), 2000000);
  assert.equal(paraCentavos("12.5"), 1250);
  assert.equal(paraCentavos("-20"), -2000);
  assert.throws(() => paraCentavos("abc"), /numérico/);
});

test("lista os meses anteriores atravessando o ano", () => {
  assert.deepEqual(mesesAnteriores("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
});

const categorias = [
  { id: 1, nome: "Salário", tipo: "receita", cor: "#0f0" },
  { id: 2, nome: "Mercado", tipo: "despesa", cor: "#f00" },
  { id: 3, nome: "Lazer", tipo: "despesa", cor: "#00f" }
];
const transacoes = [
  { id: 1, descricao: "Salário", valor_centavos: 300000, tipo: "receita", categoria_id: 1, data: "2026-11-05" },
  { id: 2, descricao: "Mercado", valor_centavos: 50000, tipo: "despesa", categoria_id: 2, data: "2026-11-08" },
  { id: 3, descricao: "Cinema", valor_centavos: 25000, tipo: "despesa", categoria_id: 3, data: "2026-11-20" },
  { id: 4, descricao: "Mercado", valor_centavos: 10000, tipo: "despesa", categoria_id: 2, data: "2026-10-15" }
];

test("resumo do mês igual ao do back-end", () => {
  const r = calcularResumo(transacoes, categorias, "2026-11");
  assert.equal(r.receitas_centavos, 300000);
  assert.equal(r.despesas_centavos, 75000);
  assert.equal(r.saldo_centavos, 225000);
  assert.equal(r.taxa_economia, 0.75);
  assert.deepEqual(r.por_categoria.map(c => c.categoria), ["Mercado", "Lazer"]);
  assert.equal(r.evolucao.length, 6);
  assert.deepEqual(r.evolucao[4], { mes: "2026-10", receitas_centavos: 0, despesas_centavos: 10000 });
});

test("filtros de transações", () => {
  assert.equal(filtrarTransacoes(transacoes, { mes: "2026-11" }).length, 3);
  assert.equal(filtrarTransacoes(transacoes, { tipo: "receita" }).length, 1);
  assert.equal(filtrarTransacoes(transacoes, { categoria_id: "2" }).length, 2);
  assert.equal(filtrarTransacoes(transacoes, { busca: "cine" })[0].id, 3);
  assert.equal(filtrarTransacoes(transacoes)[0].id, 3); // mais recente primeiro
});

test("progresso da meta calcula quanto guardar por mês", () => {
  const meta = { alvo_centavos: 1200000, guardado_centavos: 200000, prazo: "2027-10-31" };
  const p = progressoMeta(meta, new Date(2026, 10, 22)); // 22/11/2026
  assert.equal(p.faltam, 1000000);
  assert.equal(p.mesesRestantes, 12);
  assert.equal(p.porMes, 83334);
  assert.equal(progressoMeta({ alvo_centavos: 100, guardado_centavos: 150 }).concluida, true);
});

test("CSV com valores negativos para despesas", () => {
  const csv = paraCsv([{ ...transacoes[1], categoria: "Mercado" }]);
  assert.match(csv, /"08\/11\/2026";"Mercado";"Mercado";"Despesa";"-500,00"/);
});

test("modo demonstração valida e persiste como a API", async () => {
  const storage = storageFalso();
  const api = new ApiLocal(storage);
  const cats = await api.categorias();
  const alimentacao = cats.find(c => c.nome === "Alimentação");

  const t = await api.criarTransacao({ descricao: "Feira", valor: "35,50", tipo: "despesa", categoria_id: alimentacao.id, data: "2026-11-21" });
  assert.equal(t.valor_centavos, 3550);
  assert.equal(t.categoria, "Alimentação");
  await assert.rejects(api.criarTransacao({ descricao: "X", valor: "10", tipo: "receita", categoria_id: alimentacao.id, data: "2026-11-21" }), /não combina/);
  await assert.rejects(api.excluirCategoria(alimentacao.id), /em uso/);

  const meta = await api.criarMeta({ nome: "Viagem", alvo: "3.000" });
  await api.aportar(meta.id, "500");
  await assert.rejects(api.aportar(meta.id, "-900"), /retirar mais/);

  const recarregada = new ApiLocal(storage);
  assert.equal((await recarregada.transacoes()).length, 1);
  assert.equal((await recarregada.metas())[0].guardado_centavos, 50000);
  assert.equal((await recarregada.resumo("2026-11")).despesas_centavos, 3550);
});
