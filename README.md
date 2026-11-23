# 💰 Controle de Finanças Pessoais

![Testes](https://github.com/Isaac-Andrade07/controle-financas/actions/workflows/testes.yml/badge.svg)

Aplicação **full-stack** para organizar receitas, despesas e metas financeiras: uma **API REST em Python** com banco **SQLite** e um front-end em **JavaScript** com gráficos.

🔗 **Demonstração online:** https://isaac-andrade07.github.io/controle-financas/

> No GitHub Pages o site roda em **modo demonstração** (dados salvos no navegador), porque o Pages não executa Python. Clique em **Carregar dados de exemplo** para ver o painel completo. Rodando localmente com o back-end, os dados vão para o banco SQLite.

## ✨ Funcionalidades

**Visão geral**
- Receitas, despesas, saldo e taxa de economia do mês
- Gráfico comparando receitas e despesas dos últimos 6 meses
- Gráfico de despesas por categoria
- Últimas transações e progresso das metas

**Transações**
- Cadastro, edição e exclusão de receitas e despesas
- Filtros por mês, tipo, categoria e busca por descrição
- Total do filtro e exportação para CSV (abre no Excel)

**Metas**
- Metas com valor e prazo (ex.: reserva de emergência, entrada do carro)
- Guardar e retirar valores, com barra de progresso
- Cálculo automático de **quanto guardar por mês** para cumprir o prazo

**Categorias**
- Categorias de receita e despesa com cores personalizadas
- Proteção contra excluir categoria que está em uso

## 🧱 Arquitetura

```
┌────────────────────┐   fetch (JSON)   ┌──────────────────────┐      ┌──────────┐
│  Front-end (JS)    │ ───────────────▶ │  API REST (Python)   │ ───▶ │  SQLite  │
│  index.html + js/  │ ◀─────────────── │  backend/servidor.py │      │          │
└────────────────────┘                  └──────────────────────┘      └──────────┘
         │
         └── sem back-end disponível? usa o ApiLocal (localStorage) → modo demonstração
```

- **Back-end sem frameworks**: feito só com a biblioteca padrão do Python (`http.server`, `sqlite3`, `json`), com roteamento próprio por expressões regulares.
- **Camadas separadas**: `servidor.py` (HTTP e rotas), `validacao.py` (regras de entrada) e `banco.py` (SQL e relatórios).
- **Dinheiro em centavos**: os valores são guardados como inteiros para evitar erros de arredondamento (`0,1 + 0,2`).
- **Padrão adaptador no front-end**: `ApiRemota` e `ApiLocal` têm os mesmos métodos, então a interface funciona igual com ou sem servidor.
- **Segurança básica**: consultas SQL parametrizadas (contra SQL injection), escape de HTML (contra XSS), limite de tamanho das requisições e chaves estrangeiras ativadas.

## 🔌 Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/saude` | Verifica se a API está no ar |
| GET | `/api/categorias` | Lista categorias |
| POST | `/api/categorias` | Cria categoria |
| DELETE | `/api/categorias/{id}` | Exclui categoria (se não estiver em uso) |
| GET | `/api/transacoes?mes=&tipo=&categoria=&busca=` | Lista transações com filtros |
| POST | `/api/transacoes` | Cria transação |
| PUT | `/api/transacoes/{id}` | Atualiza transação |
| DELETE | `/api/transacoes/{id}` | Exclui transação |
| GET | `/api/metas` | Lista metas |
| POST | `/api/metas` | Cria meta |
| POST | `/api/metas/{id}/aporte` | Guarda (ou retira) valor da meta |
| DELETE | `/api/metas/{id}` | Exclui meta |
| GET | `/api/resumo?mes=AAAA-MM` | Totais do mês, despesas por categoria e evolução de 6 meses |

Exemplo:

```bash
curl -X POST http://localhost:8000/api/transacoes \
  -H "Content-Type: application/json" \
  -d '{"descricao": "Mercado", "valor": "150,90", "tipo": "despesa", "categoria_id": 4, "data": "2026-11-10"}'
```

Erros voltam com o status HTTP correto (400, 404, 405, 409) e uma mensagem em português.

## ▶️ Como rodar

Precisa apenas do **Python 3.10+**, sem instalar nada:

```bash
python backend/servidor.py
# acesse http://localhost:8000
```

O banco `financas.db` é criado automaticamente com categorias padrão.

## 🧪 Testes

```bash
python -m unittest discover tests -v   # 13 testes da API e do banco
npm test                                # 7 testes do front-end
```

Os testes rodam automaticamente no **GitHub Actions** a cada envio.

## 📁 Estrutura

```
backend/
  servidor.py     → servidor HTTP, rotas e respostas JSON
  banco.py        → acesso ao SQLite e relatórios
  validacao.py    → validação dos dados recebidos
js/
  api.js          → ApiRemota (back-end) e ApiLocal (modo demonstração)
  regras.js       → cálculos: resumo, metas, filtros, CSV
  graficos.js     → gráficos em Canvas
  app.js          → telas e eventos
css/style.css     → visual, tema claro/escuro e responsividade
tests/            → testes em Python (unittest) e JavaScript (node:test)
```

## 👤 Autor

**Isaac Raphael Oliveira Andrade**
Estudante de Análise e Desenvolvimento de Sistemas
