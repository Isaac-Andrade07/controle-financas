// Gráficos em Canvas, sem bibliotecas.

const cor = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

function preparar(canvas, altura) {
  const escala = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth;
  canvas.width = largura * escala;
  canvas.height = altura * escala;
  canvas.style.height = `${altura}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(escala, escala);
  ctx.font = "11px system-ui, sans-serif";
  return { ctx, largura };
}

const abreviar = centavos => {
  const reais = centavos / 100;
  return reais >= 1000 ? `${(reais / 1000).toFixed(1).replace(".", ",")} mil` : Math.round(reais).toString();
};

// Barras lado a lado: receitas x despesas por mês.
export function barrasComparativas(canvas, grupos, { altura = 240 } = {}) {
  const { ctx, largura } = preparar(canvas, altura);
  const margem = { topo: 14, base: 26, esq: 52 };
  const area = altura - margem.topo - margem.base;
  const maximo = Math.max(1, ...grupos.flatMap(g => [g.a, g.b]));
  const passo = (largura - margem.esq) / grupos.length;
  const barra = Math.min(26, passo * 0.3);

  ctx.strokeStyle = cor("--borda");
  ctx.fillStyle = cor("--suave");
  [0, 0.5, 1].forEach(f => {
    const y = margem.topo + area * (1 - f);
    ctx.beginPath();
    ctx.moveTo(margem.esq, y);
    ctx.lineTo(largura, y);
    ctx.stroke();
    ctx.fillText(abreviar(maximo * f), 4, y + 4);
  });

  grupos.forEach((g, i) => {
    const centro = margem.esq + passo * i + passo / 2;
    [[g.a, cor("--verde"), -1], [g.b, cor("--vermelho"), 0]].forEach(([v, c, desloc]) => {
      const h = (v / maximo) * area;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(centro + desloc * barra - (desloc ? 2 : -2), margem.topo + area - h, barra, h, [4, 4, 0, 0]);
      ctx.fill();
    });
    ctx.fillStyle = cor("--suave");
    ctx.textAlign = "center";
    ctx.fillText(g.rotulo, centro, altura - 8);
    ctx.textAlign = "start";
  });
  canvas.setAttribute("aria-label", grupos.map(g => `${g.rotulo}: receitas ${abreviar(g.a)}, despesas ${abreviar(g.b)}`).join("; "));
}

// Rosca com o total no centro.
export function rosca(canvas, partes, { altura = 220, rotulo = "" } = {}) {
  const { ctx, largura } = preparar(canvas, altura);
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const cx = largura / 2;
  const cy = altura / 2;
  const raio = Math.min(cx, cy) - 20;
  ctx.lineWidth = 24;

  if (!total) {
    ctx.strokeStyle = cor("--borda");
    ctx.beginPath();
    ctx.arc(cx, cy, raio, 0, Math.PI * 2);
    ctx.stroke();
  }
  let inicio = -Math.PI / 2;
  partes.forEach(p => {
    const fim = inicio + (p.valor / total) * Math.PI * 2;
    ctx.strokeStyle = p.cor;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, inicio, fim);
    ctx.stroke();
    inicio = fim;
  });

  ctx.textAlign = "center";
  ctx.fillStyle = cor("--texto");
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText(rotulo, cx, cy + 4);
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = cor("--suave");
  ctx.fillText("em despesas", cx, cy + 22);
  ctx.textAlign = "start";
  canvas.setAttribute("aria-label", partes.map(p => `${p.nome}: ${abreviar(p.valor)}`).join(", "));
}
