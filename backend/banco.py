"""Camada de dados: guarda tudo em SQLite e calcula os relatórios.

Os valores em dinheiro são guardados em centavos (números inteiros)
para evitar erros de arredondamento com casas decimais.
"""

import sqlite3
from contextlib import contextmanager
from datetime import date

CATEGORIAS_PADRAO = [
    ("Salário", "receita", "#16a34a"),
    ("Freelance", "receita", "#0ea5e9"),
    ("Moradia", "despesa", "#ef4444"),
    ("Alimentação", "despesa", "#f59e0b"),
    ("Transporte", "despesa", "#8b5cf6"),
    ("Lazer", "despesa", "#ec4899"),
    ("Estudos", "despesa", "#14b8a6"),
    ("Outros", "despesa", "#64748b"),
]

ESQUEMA = """
CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
    cor TEXT NOT NULL DEFAULT '#64748b',
    UNIQUE (nome, tipo)
);

CREATE TABLE IF NOT EXISTS transacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
    categoria_id INTEGER NOT NULL REFERENCES categorias (id),
    data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes (data);

CREATE TABLE IF NOT EXISTS metas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    alvo_centavos INTEGER NOT NULL CHECK (alvo_centavos > 0),
    guardado_centavos INTEGER NOT NULL DEFAULT 0 CHECK (guardado_centavos >= 0),
    prazo TEXT
);
"""


class ErroNegocio(Exception):
    """Erro de regra de negócio, mostrado ao usuário com status 400/404/409."""

    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)
        self.status = status


def meses_anteriores(mes, quantidade):
    """Lista os 'quantidade' meses até 'mes' (inclusive), do mais antigo ao mais novo."""
    ano, m = map(int, mes.split("-"))
    resultado = []
    for _ in range(quantidade):
        resultado.append(f"{ano:04d}-{m:02d}")
        m -= 1
        if m == 0:
            ano, m = ano - 1, 12
    return list(reversed(resultado))


class Banco:
    def __init__(self, caminho="financas.db"):
        self.caminho = caminho
        # Banco em memória precisa de uma conexão única para não perder os dados.
        self._conexao_fixa = sqlite3.connect(":memory:", check_same_thread=False) if caminho == ":memory:" else None
        with self.conexao() as con:
            con.executescript(ESQUEMA)
            if con.execute("SELECT COUNT(*) FROM categorias").fetchone()[0] == 0:
                con.executemany("INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)", CATEGORIAS_PADRAO)

    @contextmanager
    def conexao(self):
        con = self._conexao_fixa or sqlite3.connect(self.caminho)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            if not self._conexao_fixa:
                con.close()

    # ---------- Categorias ----------

    def listar_categorias(self):
        with self.conexao() as con:
            linhas = con.execute("SELECT * FROM categorias ORDER BY tipo DESC, nome").fetchall()
        return [dict(l) for l in linhas]

    def criar_categoria(self, nome, tipo, cor):
        try:
            with self.conexao() as con:
                cur = con.execute("INSERT INTO categorias (nome, tipo, cor) VALUES (?, ?, ?)", (nome, tipo, cor))
                return {"id": cur.lastrowid, "nome": nome, "tipo": tipo, "cor": cor}
        except sqlite3.IntegrityError:
            raise ErroNegocio("Já existe uma categoria com esse nome.", 409)

    def excluir_categoria(self, id_):
        with self.conexao() as con:
            em_uso = con.execute("SELECT COUNT(*) FROM transacoes WHERE categoria_id = ?", (id_,)).fetchone()[0]
            if em_uso:
                raise ErroNegocio(f"Categoria em uso por {em_uso} transação(ões).", 409)
            if con.execute("DELETE FROM categorias WHERE id = ?", (id_,)).rowcount == 0:
                raise ErroNegocio("Categoria não encontrada.", 404)

    def _validar_categoria(self, con, categoria_id, tipo):
        cat = con.execute("SELECT tipo FROM categorias WHERE id = ?", (categoria_id,)).fetchone()
        if not cat:
            raise ErroNegocio("Categoria não encontrada.", 404)
        if cat["tipo"] != tipo:
            raise ErroNegocio("A categoria não combina com o tipo da transação.")

    # ---------- Transações ----------

    def listar_transacoes(self, mes=None, tipo=None, categoria_id=None, busca=None):
        sql = """SELECT t.*, c.nome AS categoria, c.cor
                 FROM transacoes t JOIN categorias c ON c.id = t.categoria_id WHERE 1 = 1"""
        params = []
        if mes:
            sql += " AND substr(t.data, 1, 7) = ?"
            params.append(mes)
        if tipo:
            sql += " AND t.tipo = ?"
            params.append(tipo)
        if categoria_id:
            sql += " AND t.categoria_id = ?"
            params.append(categoria_id)
        if busca:
            sql += " AND t.descricao LIKE ?"
            params.append(f"%{busca}%")
        sql += " ORDER BY t.data DESC, t.id DESC"
        with self.conexao() as con:
            return [dict(l) for l in con.execute(sql, params).fetchall()]

    def criar_transacao(self, dados):
        with self.conexao() as con:
            self._validar_categoria(con, dados["categoria_id"], dados["tipo"])
            cur = con.execute(
                "INSERT INTO transacoes (descricao, valor_centavos, tipo, categoria_id, data) VALUES (?, ?, ?, ?, ?)",
                (dados["descricao"], dados["valor_centavos"], dados["tipo"], dados["categoria_id"], dados["data"]),
            )
            return self._buscar_transacao(con, cur.lastrowid)

    def atualizar_transacao(self, id_, dados):
        with self.conexao() as con:
            self._validar_categoria(con, dados["categoria_id"], dados["tipo"])
            cur = con.execute(
                """UPDATE transacoes SET descricao = ?, valor_centavos = ?, tipo = ?, categoria_id = ?, data = ?
                   WHERE id = ?""",
                (dados["descricao"], dados["valor_centavos"], dados["tipo"], dados["categoria_id"], dados["data"], id_),
            )
            if cur.rowcount == 0:
                raise ErroNegocio("Transação não encontrada.", 404)
            return self._buscar_transacao(con, id_)

    def excluir_transacao(self, id_):
        with self.conexao() as con:
            if con.execute("DELETE FROM transacoes WHERE id = ?", (id_,)).rowcount == 0:
                raise ErroNegocio("Transação não encontrada.", 404)

    def _buscar_transacao(self, con, id_):
        linha = con.execute(
            """SELECT t.*, c.nome AS categoria, c.cor FROM transacoes t
               JOIN categorias c ON c.id = t.categoria_id WHERE t.id = ?""",
            (id_,),
        ).fetchone()
        return dict(linha)

    # ---------- Metas ----------

    def listar_metas(self):
        with self.conexao() as con:
            return [dict(l) for l in con.execute("SELECT * FROM metas ORDER BY prazo IS NULL, prazo, id").fetchall()]

    def criar_meta(self, nome, alvo_centavos, prazo):
        with self.conexao() as con:
            cur = con.execute("INSERT INTO metas (nome, alvo_centavos, prazo) VALUES (?, ?, ?)", (nome, alvo_centavos, prazo))
            return dict(con.execute("SELECT * FROM metas WHERE id = ?", (cur.lastrowid,)).fetchone())

    def aportar_meta(self, id_, valor_centavos):
        """Soma (ou retira, se negativo) um valor guardado na meta."""
        with self.conexao() as con:
            meta = con.execute("SELECT * FROM metas WHERE id = ?", (id_,)).fetchone()
            if not meta:
                raise ErroNegocio("Meta não encontrada.", 404)
            novo = meta["guardado_centavos"] + valor_centavos
            if novo < 0:
                raise ErroNegocio("Não é possível retirar mais do que o valor guardado.")
            con.execute("UPDATE metas SET guardado_centavos = ? WHERE id = ?", (novo, id_))
            return dict(con.execute("SELECT * FROM metas WHERE id = ?", (id_,)).fetchone())

    def excluir_meta(self, id_):
        with self.conexao() as con:
            if con.execute("DELETE FROM metas WHERE id = ?", (id_,)).rowcount == 0:
                raise ErroNegocio("Meta não encontrada.", 404)

    # ---------- Relatórios ----------

    def resumo(self, mes=None):
        mes = mes or date.today().strftime("%Y-%m")
        with self.conexao() as con:
            totais = {
                l["tipo"]: l["total"]
                for l in con.execute(
                    "SELECT tipo, SUM(valor_centavos) AS total FROM transacoes WHERE substr(data, 1, 7) = ? GROUP BY tipo",
                    (mes,),
                )
            }
            por_categoria = [
                dict(l)
                for l in con.execute(
                    """SELECT c.nome AS categoria, c.cor, SUM(t.valor_centavos) AS total_centavos
                       FROM transacoes t JOIN categorias c ON c.id = t.categoria_id
                       WHERE t.tipo = 'despesa' AND substr(t.data, 1, 7) = ?
                       GROUP BY c.id ORDER BY total_centavos DESC""",
                    (mes,),
                )
            ]
            meses = meses_anteriores(mes, 6)
            linhas = con.execute(
                """SELECT substr(data, 1, 7) AS mes, tipo, SUM(valor_centavos) AS total
                   FROM transacoes WHERE substr(data, 1, 7) BETWEEN ? AND ? GROUP BY mes, tipo""",
                (meses[0], meses[-1]),
            ).fetchall()

        evolucao = {m: {"mes": m, "receitas_centavos": 0, "despesas_centavos": 0} for m in meses}
        for l in linhas:
            evolucao[l["mes"]]["receitas_centavos" if l["tipo"] == "receita" else "despesas_centavos"] = l["total"]

        receitas = totais.get("receita", 0)
        despesas = totais.get("despesa", 0)
        return {
            "mes": mes,
            "receitas_centavos": receitas,
            "despesas_centavos": despesas,
            "saldo_centavos": receitas - despesas,
            "taxa_economia": round((receitas - despesas) / receitas, 4) if receitas else 0,
            "por_categoria": por_categoria,
            "evolucao": list(evolucao.values()),
        }
