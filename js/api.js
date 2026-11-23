// Acesso aos dados com duas implementações que têm os mesmos métodos:
//  - ApiRemota: conversa com o back-end em Python (dados no SQLite)
//  - ApiLocal: guarda no navegador, para o site funcionar no GitHub Pages sem servidor
// A interface não sabe qual está usando. Isso é o padrão "adaptador".

import { paraCentavos, filtrarTransacoes, calcularResumo } from "./regras.js";

class ApiRemota {
  modo = "api";

  async requisitar(metodo, caminho, corpo) {
    const resposta = await fetch(`api/${caminho}`, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (resposta.status === 204) return null;
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Erro na requisição.");
    return dados;
  }

  categorias() { return this.requisitar("GET", "categorias"); }
  criarCategoria(dados) { return this.requisitar("POST", "categorias", dados); }
  excluirCategoria(id) { return this.requisitar("DELETE", `categorias/${id}`); }

  transacoes(filtros = {}) {
    const params = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
    return this.requisitar("GET", `transacoes?${params}`);
  }
  criarTransacao(dados) { return this.requisitar("POST", "transacoes", dados); }
  atualizarTransacao(id, dados) { return this.requisitar("PUT", `transacoes/${id}`, dados); }
  excluirTransacao(id) { return this.requisitar("DELETE", `transacoes/${id}`); }

  metas() { return this.requisitar("GET", "metas"); }
  criarMeta(dados) { return this.requisitar("POST", "metas", dados); }
  aportar(id, valor) { return this.requisitar("POST", `metas/${id}/aporte`, { valor }); }
  excluirMeta(id) { return this.requisitar("DELETE", `metas/${id}`); }

  resumo(mes) { return this.requisitar("GET", `resumo?mes=${mes}`); }
}

const CHAVE = "financas-demo";
const CATEGORIAS_PADRAO = [
  ["Salário", "receita", "#16a34a"], ["Freelance", "receita", "#0ea5e9"],
  ["Moradia", "despesa", "#ef4444"], ["Alimentação", "despesa", "#f59e0b"],
  ["Transporte", "despesa", "#8b5cf6"], ["Lazer", "despesa", "#ec4899"],
  ["Estudos", "despesa", "#14b8a6"], ["Outros", "despesa", "#64748b"]
];

export class ApiLocal {
  modo = "demo";

  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.dados = this.carregar();
  }

  carregar() {
    try {
      const salvo = JSON.parse(this.storage?.getItem(CHAVE));
      if (salvo?.categorias) return salvo;
    } catch { /* começa do zero */ }
    return {
      seq: CATEGORIAS_PADRAO.length,
      categorias: CATEGORIAS_PADRAO.map(([nome, tipo, cor], i) => ({ id: i + 1, nome, tipo, cor })),
      transacoes: [],
      metas: []
    };
  }

  salvar() {
    try { this.storage?.setItem(CHAVE, JSON.stringify(this.dados)); } catch { /* sem armazenamento */ }
  }

  novoId() { return ++this.dados.seq; }

  async categorias() {
    return [...this.dados.categorias].sort((a, b) => b.tipo.localeCompare(a.tipo) || a.nome.localeCompare(b.nome));
  }

  async criarCategoria({ nome, tipo, cor }) {
    nome = String(nome || "").trim();
    if (!nome) throw new Error("O campo 'nome' é obrigatório.");
    if (this.dados.categorias.some(c => c.nome.toLowerCase() === nome.toLowerCase() && c.tipo === tipo)) {
      throw new Error("Já existe uma categoria com esse nome.");
    }
    const categoria = { id: this.novoId(), nome, tipo, cor: cor || "#64748b" };
    this.dados.categorias.push(categoria);
    this.salvar();
    return categoria;
  }

  async excluirCategoria(id) {
    const emUso = this.dados.transacoes.filter(t => t.categoria_id === id).length;
    if (emUso) throw new Error(`Categoria em uso por ${emUso} transação(ões).`);
    this.dados.categorias = this.dados.categorias.filter(c => c.id !== id);
    this.salvar();
  }

  validarTransacao(dados) {
    const descricao = String(dados.descricao || "").trim();
    if (!descricao) throw new Error("O campo 'descricao' é obrigatório.");
    const valor_centavos = paraCentavos(dados.valor);
    if (valor_centavos <= 0) throw new Error("O campo 'valor' precisa ser maior que zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.data || "")) throw new Error("Informe uma data válida.");
    const categoria = this.dados.categorias.find(c => c.id === Number(dados.categoria_id));
    if (!categoria) throw new Error("Categoria não encontrada.");
    if (categoria.tipo !== dados.tipo) throw new Error("A categoria não combina com o tipo da transação.");
    return { descricao, valor_centavos, tipo: dados.tipo, categoria_id: categoria.id, data: dados.data };
  }

  comCategoria(t) {
    const c = this.dados.categorias.find(x => x.id === t.categoria_id) || {};
    return { ...t, categoria: c.nome, cor: c.cor };
  }

  async transacoes(filtros = {}) {
    return filtrarTransacoes(this.dados.transacoes, filtros).map(t => this.comCategoria(t));
  }

  async criarTransacao(dados) {
    const t = { id: this.novoId(), ...this.validarTransacao(dados) };
    this.dados.transacoes.push(t);
    this.salvar();
    return this.comCategoria(t);
  }

  async atualizarTransacao(id, dados) {
    const t = this.dados.transacoes.find(x => x.id === id);
    if (!t) throw new Error("Transação não encontrada.");
    Object.assign(t, this.validarTransacao(dados));
    this.salvar();
    return this.comCategoria(t);
  }

  async excluirTransacao(id) {
    this.dados.transacoes = this.dados.transacoes.filter(t => t.id !== id);
    this.salvar();
  }

  async metas() {
    return [...this.dados.metas].sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
  }

  async criarMeta({ nome, alvo, prazo }) {
    nome = String(nome || "").trim();
    if (!nome) throw new Error("O campo 'nome' é obrigatório.");
    const alvo_centavos = paraCentavos(alvo);
    if (alvo_centavos <= 0) throw new Error("O valor da meta precisa ser maior que zero.");
    const meta = { id: this.novoId(), nome, alvo_centavos, guardado_centavos: 0, prazo: prazo || null };
    this.dados.metas.push(meta);
    this.salvar();
    return meta;
  }

  async aportar(id, valor) {
    const meta = this.dados.metas.find(m => m.id === id);
    if (!meta) throw new Error("Meta não encontrada.");
    const novo = meta.guardado_centavos + paraCentavos(valor);
    if (novo < 0) throw new Error("Não é possível retirar mais do que o valor guardado.");
    meta.guardado_centavos = novo;
    this.salvar();
    return meta;
  }

  async excluirMeta(id) {
    this.dados.metas = this.dados.metas.filter(m => m.id !== id);
    this.salvar();
  }

  async resumo(mes) {
    return calcularResumo(this.dados.transacoes, this.dados.categorias, mes);
  }

  // Gera 6 meses de lançamentos fictícios para demonstrar o painel.
  async carregarExemplo(hoje = new Date()) {
    const cat = nome => this.dados.categorias.find(c => c.nome === nome)?.id;
    const dia = (offsetMes, d) => {
      const data = new Date(hoje.getFullYear(), hoje.getMonth() - offsetMes, Math.min(d, 28));
      return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
    };
    const variar = (base, pct) => Math.round(base * (1 + (Math.random() * 2 - 1) * pct));
    const lancamentos = [];
    for (let m = 5; m >= 0; m--) {
      const limite = m === 0 ? hoje.getDate() : 28;
      const add = (descricao, valor, tipo, categoria, d) => {
        if (d <= limite && cat(categoria)) {
          lancamentos.push({ id: this.novoId(), descricao, valor_centavos: valor, tipo, categoria_id: cat(categoria), data: dia(m, d) });
        }
      };
      add("Salário", 255000, "receita", "Salário", 5);
      if (Math.random() < 0.5) add("Projeto freelance", variar(40000, 0.4), "receita", "Freelance", 18);
      add("Aluguel", 80000, "despesa", "Moradia", 10);
      add("Conta de luz", variar(12000, 0.2), "despesa", "Moradia", 12);
      add("Mercado", variar(42000, 0.15), "despesa", "Alimentação", 8);
      add("Mercado", variar(25000, 0.2), "despesa", "Alimentação", 22);
      add("Transporte", variar(18000, 0.1), "despesa", "Transporte", 3);
      add("Curso online", 6000, "despesa", "Estudos", 15);
      if (Math.random() < 0.7) add("Cinema e lanche", variar(9000, 0.3), "despesa", "Lazer", 20);
    }
    this.dados.transacoes.push(...lancamentos);
    if (!this.dados.metas.length) {
      const prazo = (anos) => `${hoje.getFullYear() + anos}-12-31`;
      this.dados.metas.push(
        { id: this.novoId(), nome: "Reserva de emergência", alvo_centavos: 765000, guardado_centavos: 210000, prazo: prazo(1) },
        { id: this.novoId(), nome: "Entrada do carro", alvo_centavos: 2000000, guardado_centavos: 150000, prazo: prazo(2) }
      );
    }
    this.salvar();
  }

  async limpar() {
    this.storage?.removeItem(CHAVE);
    this.dados = this.carregar();
  }
}

// Usa o back-end se ele estiver rodando; senão, cai para o modo demonstração.
export async function conectar() {
  try {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), 1500);
    const resposta = await fetch("api/saude", { signal: controle.signal });
    clearTimeout(timer);
    if (resposta.ok && (await resposta.json()).status === "ok") return new ApiRemota();
  } catch { /* sem back-end */ }
  return new ApiLocal();
}
