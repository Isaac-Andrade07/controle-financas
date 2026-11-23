"""Validação dos dados que chegam pela API.

Cada função recebe o JSON enviado pelo front-end e devolve os dados limpos,
ou lança ErroValidacao com uma mensagem clara para o usuário.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

TIPOS = ("receita", "despesa")
COR = re.compile(r"^#[0-9a-fA-F]{6}$")


class ErroValidacao(Exception):
    pass


def texto(dados, campo, maximo=80, obrigatorio=True):
    valor = str(dados.get(campo) or "").strip()
    if obrigatorio and not valor:
        raise ErroValidacao(f"O campo '{campo}' é obrigatório.")
    if len(valor) > maximo:
        raise ErroValidacao(f"O campo '{campo}' aceita no máximo {maximo} caracteres.")
    return valor


def centavos(dados, campo, permitir_negativo=False):
    """Converte valores como 49.9, "49,90" ou "1.234,56" para centavos (int)."""
    bruto = dados.get(campo)
    if isinstance(bruto, str):
        bruto = bruto.strip().replace("R$", "").strip()
        if "," in bruto:
            bruto = bruto.replace(".", "").replace(",", ".")
        elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", bruto):
            bruto = bruto.replace(".", "")  # "20.000" no padrão brasileiro = vinte mil
    try:
        valor = Decimal(str(bruto))
    except (InvalidOperation, ValueError):
        raise ErroValidacao(f"O campo '{campo}' precisa ser um número.")
    if not valor.is_finite():
        raise ErroValidacao(f"O campo '{campo}' precisa ser um número.")
    resultado = int((valor * 100).quantize(Decimal("1")))
    if resultado == 0 or (resultado < 0 and not permitir_negativo):
        raise ErroValidacao(f"O campo '{campo}' precisa ser maior que zero.")
    if abs(resultado) > 100_000_000_00:
        raise ErroValidacao(f"O campo '{campo}' passou do limite permitido.")
    return resultado


def data_iso(dados, campo, obrigatorio=True):
    valor = str(dados.get(campo) or "").strip()
    if not valor and not obrigatorio:
        return None
    try:
        return date.fromisoformat(valor).isoformat()
    except ValueError:
        raise ErroValidacao(f"O campo '{campo}' precisa ser uma data no formato AAAA-MM-DD.")


def tipo(dados):
    valor = dados.get("tipo")
    if valor not in TIPOS:
        raise ErroValidacao("O tipo precisa ser 'receita' ou 'despesa'.")
    return valor


def inteiro(dados, campo):
    try:
        return int(dados.get(campo))
    except (TypeError, ValueError):
        raise ErroValidacao(f"O campo '{campo}' é obrigatório.")


def transacao(dados):
    return {
        "descricao": texto(dados, "descricao"),
        "valor_centavos": centavos(dados, "valor"),
        "tipo": tipo(dados),
        "categoria_id": inteiro(dados, "categoria_id"),
        "data": data_iso(dados, "data"),
    }


def categoria(dados):
    cor = str(dados.get("cor") or "#64748b")
    if not COR.match(cor):
        raise ErroValidacao("A cor precisa estar no formato #RRGGBB.")
    return {"nome": texto(dados, "nome", 30), "tipo": tipo(dados), "cor": cor}


def meta(dados):
    return {
        "nome": texto(dados, "nome", 50),
        "alvo_centavos": centavos(dados, "alvo"),
        "prazo": data_iso(dados, "prazo", obrigatorio=False),
    }


def mes(valor):
    if valor is None:
        return None
    if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", valor):
        raise ErroValidacao("O mês precisa estar no formato AAAA-MM.")
    return valor
