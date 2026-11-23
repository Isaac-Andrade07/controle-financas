// Interface: liga as telas à API (remota ou local).

import { conectar } from "./api.js";
import { formatarMoeda, mesAtual, nomeMes, progressoMeta, paraCsv } from "./regras.js";
import { barrasComparativas, rosca } from "./graficos.js";

const $ = id => document.getElementById(id);
const ROTAS = ["visao", "transacoes", "metas", "categorias"];
const estado = { api: null, rota: "visao", mes: mesAtual(), categorias: [], editando: null };

// ---------- Utilitários ----------

const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataBr = iso => (iso ? iso.split("-").reverse().join("/") : "—");
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function aviso(texto) {
  const t = $("toast");
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(aviso.timer);
  aviso.timer = setTimeout(() => { t.hidden = true; }, 2800);
}

async function tentar(acao, mensagemOk) {
  try {
    const r = await acao();
    if (mensagemOk) aviso(mensagemOk);
    return r;
  } catch (erro) {
    aviso(erro.message);
    return undefined;
  }
}

function valorComSinal(t) {
  const sinal = t.tipo === "receita" ? "+" : "−";
  return `<span class="valor ${t.tipo === "receita" ? "positivo" : "negativo"}">${sinal} ${formatarMoeda(t.valor_centavos)}</span>`;
}

// ---------- Renderização ----------

async function render() {
  estado.categorias = await estado.api.categorias();
  if (estado.rota === "visao") await renderVisao();
  if (estado.rota === "transacoes") await renderTransacoes();
  if (estado.rota === "metas") await renderMetas();
  if (estado.rota === "categorias") renderCategorias();
}

async function renderVisao() {
  const [r, ultimas, metas] = await Promise.all([
    estado.api.resumo(estado.mes),
    estado.api.transacoes({ mes: estado.mes }),
    estado.api.metas()
  ]);
  $("tituloMes").textContent = `Visão geral · ${nomeMes(estado.mes, "long")}`;

  const taxa = Math.round(r.taxa_economia * 100);
  $("kpis").innerHTML = `
    <div class="kpi"><span>Receitas</span><strong class="positivo">${formatarMoeda(r.receitas_centavos)}</strong></div>
    <div class="kpi"><span>Despesas</span><strong class="negativo">${formatarMoeda(r.despesas_centavos)}</strong></div>
    <div class="kpi"><span>Saldo do mês</span><strong class="${r.saldo_centavos >= 0 ? "positivo" : "negativo"}">${formatarMoeda(r.saldo_centavos)}</strong></div>
    <div class="kpi"><span>Taxa de economia</span><strong>${taxa}%</strong>
      <small>${taxa >= 20 ? "Ótimo! Acima dos 20% recomendados." : r.receitas_centavos ? "A meta comum é guardar 20%." : "Sem receitas no mês."}</small></div>`;

  barrasComparativas($("grafEvolucao"), r.evolucao.map(e => ({
    rotulo: nomeMes(e.mes), a: e.receitas_centavos, b: e.despesas_centavos
  })), { altura: 330 });

  rosca($("grafCategorias"), r.por_categoria.map(c => ({ nome: c.categoria, valor: c.total_centavos, cor: c.cor })),
    { rotulo: formatarMoeda(r.despesas_centavos) });
  $("legendaCategorias").innerHTML = r.por_categoria.length
    ? r.por_categoria.map(c => {
      const pct = Math.round((c.total_centavos / r.despesas_centavos) * 100);
      return `<li style="--c:${esc(c.cor)}"><i></i>${esc(c.categoria)} <small>${pct}%</small><b>${formatarMoeda(c.total_centavos)}</b></li>`;
    }).join("")
    : `<li class="vazio">Nenhuma despesa neste mês.</li>`;

  $("ultimas").innerHTML = ultimas.slice(0, 6).map(t => `
    <li><div>${esc(t.descricao)}<small>${dataBr(t.data)} · ${esc(t.categoria)}</small></div>${valorComSinal(t)}</li>`).join("")
    || `<li class="vazio">Nenhuma transação neste mês.</li>`;

  $("resumoMetas").innerHTML = metas.slice(0, 4).map(m => {
    const p = progressoMeta(m);
    return `<div class="meta-mini"><div><span>${esc(m.nome)}</span><b>${Math.round(p.percentual * 100)}%</b></div>
      <div class="progresso"><span style="width:${p.percentual * 100}%"></span></div></div>`;
  }).join("") || `<p class="vazio">Nenhuma meta criada.</p>`;
}

async function renderTransacoes() {
  const filtros = { mes: estado.mes, tipo: $("fTipo").value, categoria_id: $("fCategoria").value, busca: $("fBusca").value };
  preencherCategorias($("fCategoria"), estado.categorias, "Todas as categorias");
  const lista = await estado.api.transacoes(filtros);

  $("tabela").innerHTML = lista.map(t => `
    <tr>
      <td>${dataBr(t.data)}</td>
      <td>${esc(t.descricao)}</td>
      <td><span class="tag" style="--c:${esc(t.cor)}"><i></i>${esc(t.categoria)}</span></td>
      <td class="direita">${valorComSinal(t)}</td>
      <td class="direita"><button class="btn sec mini" data-editar="${t.id}">Editar</button></td>
    </tr>`).join("");
  $("tabelaVazia").hidden = lista.length > 0;

  const total = lista.reduce((s, t) => s + (t.tipo === "receita" ? t.valor_centavos : -t.valor_centavos), 0);
  $("totalFiltro").innerHTML = `<span class="${total >= 0 ? "positivo" : "negativo"}">${formatarMoeda(total)}</span>`;
  estado.ultimaLista = lista;
}

async function renderMetas() {
  const metas = await estado.api.metas();
  $("listaMetas").innerHTML = metas.map(m => {
    const p = progressoMeta(m);
    const dica = p.concluida
      ? `<span class="concluida">Meta concluída! 🎉</span>`
      : p.porMes
        ? `<span class="dica">Guardando <b>${formatarMoeda(p.porMes)}</b> por mês você chega lá até ${dataBr(m.prazo)}.</span>`
        : `<span class="dica">Faltam ${formatarMoeda(p.faltam)}.</span>`;
    return `<article class="card meta">
      <header><h3>${esc(m.nome)}</h3><button class="btn sec mini perigo" data-excluir-meta="${m.id}">Excluir</button></header>
      <div class="numeros"><span><b>${formatarMoeda(m.guardado_centavos)}</b> de ${formatarMoeda(m.alvo_centavos)}</span><b>${Math.round(p.percentual * 100)}%</b></div>
      <div class="progresso"><span style="width:${p.percentual * 100}%"></span></div>
      ${dica}
      <form data-aporte="${m.id}">
        <input name="valor" inputmode="decimal" placeholder="Valor (R$)" aria-label="Valor do aporte">
        <button class="btn mini" value="guardar">Guardar</button>
        <button class="btn sec mini" value="retirar">Retirar</button>
      </form>
    </article>`;
  }).join("") || `<div class="card vazio">Crie sua primeira meta, como uma reserva de emergência ou a entrada de um carro.</div>`;
}

function renderCategorias() {
  const chip = c => `<li style="--c:${esc(c.cor)}"><i></i>${esc(c.nome)}<button data-excluir-categoria="${c.id}" aria-label="Excluir ${esc(c.nome)}">×</button></li>`;
  $("catReceitas").innerHTML = estado.categorias.filter(c => c.tipo === "receita").map(chip).join("");
  $("catDespesas").innerHTML = estado.categorias.filter(c => c.tipo === "despesa").map(chip).join("");
}

function preencherCategorias(select, categorias, primeira) {
  const atual = select.value;
  select.innerHTML = (primeira ? `<option value="">${primeira}</option>` : "") +
    categorias.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  if ([...select.options].some(o => o.value === atual)) select.value = atual;
}

// ---------- Modal de transação ----------

function abrirTransacao(t = null) {
  const form = $("formTransacao");
  estado.editando = t;
  form.reset();
  form.tipo.value = t?.tipo || "despesa";
  atualizarCategoriasDoModal();
  form.descricao.value = t?.descricao || "";
  form.valor.value = t ? (t.valor_centavos / 100).toFixed(2).replace(".", ",") : "";
  form.data.value = t?.data || (hoje().startsWith(estado.mes) ? hoje() : `${estado.mes}-01`);
  if (t) form.categoria_id.value = t.categoria_id;
  $("tituloTransacao").textContent = t ? "Editar transação" : "Nova transação";
  $("btnExcluirTransacao").hidden = !t;
  $("erroTransacao").textContent = "";
  $("modalTransacao").showModal();
  form.descricao.focus();
}

function atualizarCategoriasDoModal() {
  const form = $("formTransacao");
  preencherCategorias(form.categoria_id, estado.categorias.filter(c => c.tipo === form.tipo.value));
}

async function salvarTransacao(e) {
  e.preventDefault();
  const form = e.target;
  const dados = Object.fromEntries(new FormData(form));
  dados.categoria_id = Number(dados.categoria_id);
  try {
    if (estado.editando) await estado.api.atualizarTransacao(estado.editando.id, dados);
    else await estado.api.criarTransacao(dados);
    $("modalTransacao").close();
    aviso(estado.editando ? "Transação atualizada." : "Transação adicionada.");
    if (!dados.data.startsWith(estado.mes)) {
      estado.mes = dados.data.slice(0, 7);
      $("mes").value = estado.mes;
    }
    render();
  } catch (erro) {
    $("erroTransacao").textContent = erro.message;
  }
}

// ---------- Eventos ----------

function irPara() {
  const rota = location.hash.replace("#/", "");
  estado.rota = ROTAS.includes(rota) ? rota : "visao";
  document.querySelectorAll("[data-view]").forEach(s => { s.hidden = s.dataset.view !== estado.rota; });
  document.querySelectorAll("[data-rota]").forEach(a => a.classList.toggle("ativo", a.dataset.rota === estado.rota));
  render();
}

function configurar() {
  $("mes").value = estado.mes;
  $("mes").addEventListener("change", e => { estado.mes = e.target.value || mesAtual(); render(); });
  $("btnNova").addEventListener("click", () => abrirTransacao());

  const form = $("formTransacao");
  form.addEventListener("submit", salvarTransacao);
  form.querySelectorAll("[name=tipo]").forEach(r => r.addEventListener("change", atualizarCategoriasDoModal));
  $("btnExcluirTransacao").addEventListener("click", async () => {
    if (!confirm("Excluir esta transação?")) return;
    await tentar(() => estado.api.excluirTransacao(estado.editando.id), "Transação excluída.");
    $("modalTransacao").close();
    render();
  });
  document.querySelectorAll("dialog").forEach(d => d.addEventListener("click", e => {
    if (e.target === d || e.target.closest("[data-fechar]")) d.close();
  }));

  ["fBusca", "fTipo", "fCategoria"].forEach(id => $(id).addEventListener("input", renderTransacoes));
  $("tabela").addEventListener("click", e => {
    const id = Number(e.target.dataset.editar);
    if (id) abrirTransacao(estado.ultimaLista.find(t => t.id === id));
  });
  $("btnCsv").addEventListener("click", () => {
    if (!estado.ultimaLista?.length) return aviso("Nenhuma transação para exportar.");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([paraCsv(estado.ultimaLista)], { type: "text/csv;charset=utf-8" }));
    link.download = `transacoes-${estado.mes}.csv`;
    link.click();
  });

  $("formMeta").addEventListener("submit", async e => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    if (await tentar(() => estado.api.criarMeta(dados), "Meta criada.")) {
      e.target.reset();
      render();
    }
  });
  $("listaMetas").addEventListener("submit", async e => {
    e.preventDefault();
    const id = Number(e.target.dataset.aporte);
    const valor = e.target.valor.value.trim();
    if (!valor) return aviso("Informe um valor.");
    const retirar = e.submitter?.value === "retirar";
    const ok = await tentar(() => estado.api.aportar(id, retirar ? `-${valor}` : valor), retirar ? "Valor retirado." : "Valor guardado!");
    if (ok) render();
  });
  $("listaMetas").addEventListener("click", async e => {
    const id = Number(e.target.dataset.excluirMeta);
    if (id && confirm("Excluir esta meta?")) {
      await tentar(() => estado.api.excluirMeta(id), "Meta excluída.");
      render();
    }
  });

  $("formCategoria").addEventListener("submit", async e => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    if (await tentar(() => estado.api.criarCategoria(dados), "Categoria criada.")) {
      e.target.nome.value = "";
      render();
    }
  });
  document.querySelector('[data-view="categorias"]').addEventListener("click", async e => {
    const id = Number(e.target.dataset.excluirCategoria);
    if (id) {
      await tentar(() => estado.api.excluirCategoria(id), "Categoria excluída.");
      render();
    }
  });

  $("btnTema").addEventListener("click", () => {
    const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("financas-tema", novo); } catch {}
    atualizarBotaoTema();
    render();
  });
  atualizarBotaoTema();

  window.addEventListener("hashchange", irPara);
  window.addEventListener("resize", () => estado.rota === "visao" && renderVisao());
}

function atualizarBotaoTema() {
  $("btnTema").textContent = document.documentElement.dataset.tema === "escuro" ? "☀️" : "🌙";
}

function mostrarModo() {
  const faixa = $("faixaModo");
  faixa.hidden = false;
  if (estado.api.modo === "api") {
    faixa.classList.add("api");
    $("textoModo").textContent = "Conectado ao back-end em Python: os dados estão no banco SQLite.";
    $("btnExemplo").hidden = true;
    $("btnLimparDemo").hidden = true;
    return;
  }
  $("textoModo").textContent = "Modo demonstração: os dados ficam salvos só no seu navegador.";
  $("btnExemplo").addEventListener("click", async () => {
    await estado.api.carregarExemplo();
    aviso("Dados de exemplo carregados.");
    render();
  });
  $("btnLimparDemo").addEventListener("click", async () => {
    if (!confirm("Apagar todos os dados da demonstração?")) return;
    await estado.api.limpar();
    aviso("Dados apagados.");
    render();
  });
}

async function iniciar() {
  estado.api = await conectar();
  mostrarModo();
  configurar();
  irPara();
}

iniciar();
