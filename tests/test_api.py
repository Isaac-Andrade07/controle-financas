"""Testes da API. Rode com:  python -m unittest discover tests"""

import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ["FINANCAS_SILENCIOSO"] = "1"

from banco import meses_anteriores  # noqa: E402
from servidor import Aplicacao  # noqa: E402
import validacao  # noqa: E402


class TesteApi(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.servidor = Aplicacao(("127.0.0.1", 0), os.path.join(self.pasta.name, "teste.db"))
        self.base = f"http://127.0.0.1:{self.servidor.server_address[1]}"
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()
        self.pasta.cleanup()

    def chamar(self, metodo, caminho, corpo=None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        req = Request(self.base + caminho, data=dados, method=metodo, headers={"Content-Type": "application/json"})
        try:
            with urlopen(req) as resp:
                texto = resp.read().decode()
                return resp.status, json.loads(texto) if texto else None
        except HTTPError as erro:
            return erro.code, json.loads(erro.read().decode() or "null")

    def categoria(self, nome, tipo="despesa"):
        _, cats = self.chamar("GET", "/api/categorias")
        return next(c["id"] for c in cats if c["nome"] == nome and c["tipo"] == tipo)

    def nova_transacao(self, **extra):
        corpo = {"descricao": "Mercado", "valor": "150,90", "tipo": "despesa",
                 "categoria_id": self.categoria("Alimentação"), "data": "2026-11-10"}
        corpo.update(extra)
        return self.chamar("POST", "/api/transacoes", corpo)

    def test_saude_e_categorias_padrao(self):
        self.assertEqual(self.chamar("GET", "/api/saude"), (200, {"status": "ok"}))
        status, cats = self.chamar("GET", "/api/categorias")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(cats), 8)

    def test_criar_transacao_converte_para_centavos(self):
        status, t = self.nova_transacao()
        self.assertEqual(status, 201)
        self.assertEqual(t["valor_centavos"], 15090)
        self.assertEqual(t["categoria"], "Alimentação")

    def test_validacao_retorna_400(self):
        status, erro = self.nova_transacao(valor="-10")
        self.assertEqual(status, 400)
        self.assertIn("maior que zero", erro["erro"])
        status, _ = self.nova_transacao(data="10/11/2026")
        self.assertEqual(status, 400)
        status, _ = self.nova_transacao(descricao="")
        self.assertEqual(status, 400)

    def test_categoria_precisa_combinar_com_tipo(self):
        status, erro = self.nova_transacao(tipo="receita")
        self.assertEqual(status, 400)
        self.assertIn("não combina", erro["erro"])

    def test_atualizar_excluir_e_404(self):
        _, t = self.nova_transacao()
        status, novo = self.chamar("PUT", f"/api/transacoes/{t['id']}", {
            "descricao": "Feira", "valor": 80, "tipo": "despesa",
            "categoria_id": t["categoria_id"], "data": "2026-11-11"})
        self.assertEqual((status, novo["descricao"], novo["valor_centavos"]), (200, "Feira", 8000))
        self.assertEqual(self.chamar("DELETE", f"/api/transacoes/{t['id']}")[0], 204)
        self.assertEqual(self.chamar("DELETE", f"/api/transacoes/{t['id']}")[0], 404)

    def test_filtros_da_listagem(self):
        self.nova_transacao(descricao="Aluguel", valor=1200, categoria_id=self.categoria("Moradia"))
        self.nova_transacao(descricao="Salário", valor=3000, tipo="receita",
                            categoria_id=self.categoria("Salário", "receita"), data="2026-11-05")
        self.nova_transacao(descricao="Mercado outubro", data="2026-10-20")

        self.assertEqual(len(self.chamar("GET", "/api/transacoes?mes=2026-11")[1]), 2)
        self.assertEqual(len(self.chamar("GET", "/api/transacoes?tipo=receita")[1]), 1)
        self.assertEqual(len(self.chamar("GET", "/api/transacoes?busca=aluguel")[1]), 1)
        self.assertEqual(self.chamar("GET", "/api/transacoes?mes=2026-13")[0], 400)

    def test_resumo_do_mes(self):
        self.nova_transacao(descricao="Salário", valor=3000, tipo="receita",
                            categoria_id=self.categoria("Salário", "receita"), data="2026-11-05")
        self.nova_transacao(valor=500)
        self.nova_transacao(valor=250, categoria_id=self.categoria("Transporte"))
        self.nova_transacao(valor=100, data="2026-10-15")

        status, r = self.chamar("GET", "/api/resumo?mes=2026-11")
        self.assertEqual(status, 200)
        self.assertEqual((r["receitas_centavos"], r["despesas_centavos"], r["saldo_centavos"]), (300000, 75000, 225000))
        self.assertEqual(r["taxa_economia"], 0.75)
        self.assertEqual(r["por_categoria"][0]["categoria"], "Alimentação")
        self.assertEqual(len(r["evolucao"]), 6)
        self.assertEqual(r["evolucao"][-2], {"mes": "2026-10", "receitas_centavos": 0, "despesas_centavos": 10000})

    def test_categorias_criar_duplicada_e_em_uso(self):
        status, cat = self.chamar("POST", "/api/categorias", {"nome": "Pets", "tipo": "despesa", "cor": "#123abc"})
        self.assertEqual(status, 201)
        self.assertEqual(self.chamar("POST", "/api/categorias", {"nome": "Pets", "tipo": "despesa"})[0], 409)
        self.assertEqual(self.chamar("POST", "/api/categorias", {"nome": "X", "tipo": "despesa", "cor": "azul"})[0], 400)
        self.nova_transacao(categoria_id=cat["id"])
        self.assertEqual(self.chamar("DELETE", f"/api/categorias/{cat['id']}")[0], 409)

    def test_metas_com_aporte_e_retirada(self):
        status, meta = self.chamar("POST", "/api/metas", {"nome": "Carro", "alvo": "20.000,00", "prazo": "2027-12-31"})
        self.assertEqual((status, meta["alvo_centavos"]), (201, 2000000))
        _, meta = self.chamar("POST", f"/api/metas/{meta['id']}/aporte", {"valor": 500})
        self.assertEqual(meta["guardado_centavos"], 50000)
        _, meta = self.chamar("POST", f"/api/metas/{meta['id']}/aporte", {"valor": -200})
        self.assertEqual(meta["guardado_centavos"], 30000)
        status, erro = self.chamar("POST", f"/api/metas/{meta['id']}/aporte", {"valor": -1000})
        self.assertEqual(status, 400)
        self.assertEqual(self.chamar("DELETE", f"/api/metas/{meta['id']}")[0], 204)

    def test_rotas_invalidas(self):
        self.assertEqual(self.chamar("GET", "/api/nada")[0], 404)
        self.assertEqual(self.chamar("DELETE", "/api/resumo")[0], 405)
        req = Request(self.base + "/api/transacoes", data=b"{quebrado", method="POST")
        with self.assertRaises(HTTPError) as ctx:
            urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_nao_expoe_codigo_do_backend(self):
        self.assertEqual(self.chamar("GET", "/backend/banco.py")[0], 404)


class TesteFuncoes(unittest.TestCase):
    def test_meses_anteriores_atravessa_o_ano(self):
        self.assertEqual(meses_anteriores("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"])

    def test_conversao_de_valores(self):
        self.assertEqual(validacao.centavos({"v": "1.234,56"}, "v"), 123456)
        self.assertEqual(validacao.centavos({"v": 0.1}, "v"), 10)
        self.assertEqual(validacao.centavos({"v": "R$ 49,90"}, "v"), 4990)
        self.assertEqual(validacao.centavos({"v": "20.000"}, "v"), 2000000)
        self.assertEqual(validacao.centavos({"v": "12.5"}, "v"), 1250)
        with self.assertRaises(validacao.ErroValidacao):
            validacao.centavos({"v": "abc"}, "v")


if __name__ == "__main__":
    unittest.main()
