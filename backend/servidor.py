"""Servidor HTTP com a API REST e os arquivos do front-end.

Feito só com a biblioteca padrão do Python, sem frameworks.
Para rodar:  python backend/servidor.py   e abra http://localhost:8000
"""

import json
import os
import re
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))

import validacao  # noqa: E402
from banco import Banco, ErroNegocio  # noqa: E402

RAIZ_FRONT = Path(__file__).resolve().parent.parent
TAMANHO_MAXIMO = 64 * 1024  # 64 KB por requisição

ROTAS = []


def rota(metodo, padrao):
    """Decorador que registra uma função para um método e caminho, ex.: GET /api/metas/<id>."""
    regex = re.compile("^" + re.sub(r"<(\w+)>", r"(?P<\1>\\d+)", padrao) + "$")

    def registrar(funcao):
        ROTAS.append((metodo, regex, funcao))
        return funcao

    return registrar


# ---------- Rotas ----------

@rota("GET", "/api/saude")
def saude(app, **_):
    return {"status": "ok"}


@rota("GET", "/api/categorias")
def listar_categorias(app, **_):
    return app.banco.listar_categorias()


@rota("POST", "/api/categorias")
def criar_categoria(app, corpo, **_):
    return app.banco.criar_categoria(**validacao.categoria(corpo)), HTTPStatus.CREATED


@rota("DELETE", "/api/categorias/<id>")
def excluir_categoria(app, id, **_):
    app.banco.excluir_categoria(int(id))
    return None, HTTPStatus.NO_CONTENT


@rota("GET", "/api/transacoes")
def listar_transacoes(app, query, **_):
    categoria = query.get("categoria")
    return app.banco.listar_transacoes(
        mes=validacao.mes(query.get("mes")),
        tipo=query.get("tipo") if query.get("tipo") in validacao.TIPOS else None,
        categoria_id=int(categoria) if categoria and categoria.isdigit() else None,
        busca=(query.get("busca") or "").strip() or None,
    )


@rota("POST", "/api/transacoes")
def criar_transacao(app, corpo, **_):
    return app.banco.criar_transacao(validacao.transacao(corpo)), HTTPStatus.CREATED


@rota("PUT", "/api/transacoes/<id>")
def atualizar_transacao(app, corpo, id, **_):
    return app.banco.atualizar_transacao(int(id), validacao.transacao(corpo))


@rota("DELETE", "/api/transacoes/<id>")
def excluir_transacao(app, id, **_):
    app.banco.excluir_transacao(int(id))
    return None, HTTPStatus.NO_CONTENT


@rota("GET", "/api/metas")
def listar_metas(app, **_):
    return app.banco.listar_metas()


@rota("POST", "/api/metas")
def criar_meta(app, corpo, **_):
    return app.banco.criar_meta(**validacao.meta(corpo)), HTTPStatus.CREATED


@rota("POST", "/api/metas/<id>/aporte")
def aportar_meta(app, corpo, id, **_):
    return app.banco.aportar_meta(int(id), validacao.centavos(corpo, "valor", permitir_negativo=True))


@rota("DELETE", "/api/metas/<id>")
def excluir_meta(app, id, **_):
    app.banco.excluir_meta(int(id))
    return None, HTTPStatus.NO_CONTENT


@rota("GET", "/api/resumo")
def resumo(app, query, **_):
    return app.banco.resumo(validacao.mes(query.get("mes")))


# ---------- Tratamento das requisições ----------

class Manipulador(SimpleHTTPRequestHandler):
    """Responde /api/* com JSON e qualquer outro caminho com os arquivos do front-end."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ_FRONT), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.tratar_api("GET")
        elif self.path.startswith(("/backend", "/tests", "/.")):
            self.enviar_json({"erro": "Não encontrado."}, HTTPStatus.NOT_FOUND)
        else:
            super().do_GET()

    def do_POST(self):
        self.tratar_api("POST")

    def do_PUT(self):
        self.tratar_api("PUT")

    def do_DELETE(self):
        self.tratar_api("DELETE")

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cabecalhos_cors()
        self.end_headers()

    def cabecalhos_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def ler_corpo(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho > TAMANHO_MAXIMO:
            raise validacao.ErroValidacao("Requisição grande demais.")
        if not tamanho:
            return {}
        try:
            corpo = json.loads(self.rfile.read(tamanho))
        except json.JSONDecodeError:
            raise validacao.ErroValidacao("JSON inválido.")
        if not isinstance(corpo, dict):
            raise validacao.ErroValidacao("O corpo precisa ser um objeto JSON.")
        return corpo

    def tratar_api(self, metodo):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}

        caminho_existe = False
        for metodo_rota, regex, funcao in ROTAS:
            encontrado = regex.match(url.path)
            if not encontrado:
                continue
            caminho_existe = True
            if metodo_rota != metodo:
                continue
            try:
                corpo = self.ler_corpo() if metodo in ("POST", "PUT") else {}
                resposta = funcao(self.server, corpo=corpo, query=query, **encontrado.groupdict())
                dados, status = resposta if isinstance(resposta, tuple) else (resposta, HTTPStatus.OK)
                self.enviar_json(dados, status)
            except validacao.ErroValidacao as erro:
                self.enviar_json({"erro": str(erro)}, HTTPStatus.BAD_REQUEST)
            except ErroNegocio as erro:
                self.enviar_json({"erro": str(erro)}, erro.status)
            except Exception as erro:  # erro inesperado: registra e responde 500
                self.log_error("Erro interno: %r", erro)
                self.enviar_json({"erro": "Erro interno no servidor."}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        status = HTTPStatus.METHOD_NOT_ALLOWED if caminho_existe else HTTPStatus.NOT_FOUND
        self.enviar_json({"erro": "Método não permitido." if caminho_existe else "Rota não encontrada."}, status)

    def enviar_json(self, dados, status=HTTPStatus.OK):
        self.send_response(status)
        self.cabecalhos_cors()
        if dados is None:
            self.end_headers()
            return
        conteudo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(conteudo)))
        self.end_headers()
        self.wfile.write(conteudo)

    def log_message(self, formato, *args):
        if os.environ.get("FINANCAS_SILENCIOSO") != "1":
            super().log_message(formato, *args)


class Aplicacao(ThreadingHTTPServer):
    def __init__(self, endereco, caminho_banco):
        super().__init__(endereco, Manipulador)
        self.banco = Banco(caminho_banco)


def iniciar(porta=8000, caminho_banco="financas.db"):
    servidor = Aplicacao(("127.0.0.1", porta), caminho_banco)
    print(f"Controle de Finanças rodando em http://localhost:{porta}  (Ctrl+C para parar)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    iniciar(int(os.environ.get("PORTA", 8000)), os.environ.get("BANCO", "financas.db"))
