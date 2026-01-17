const fs = require("fs");

const IMPRESSORA = "\\\\localhost\\ELGIN_I9";

const ESC = "\x1B";
const GS  = "\x1D";

function imprimirPedido(pedido) {

  let txt = "";

  // =========================
  // RESET
  // =========================
  txt += ESC + "@";

  // =========================
  // CABEÇALHO
  // =========================
  txt += ESC + "a" + "\x01"; // Centralizado
  txt += ESC + "E" + "\x01"; // Negrito ON
  txt += "RD DISTRIBUIDORA\n";
  txt += ESC + "E" + "\x00"; // Negrito OFF
  txt += "AGUA • GAS • CONVENIENCIA\n";
  txt += "--------------------------------\n";

  // =========================
  // DADOS DO PEDIDO
  // =========================
  txt += ESC + "a" + "\x00"; // Alinhado à esquerda

  txt += `PEDIDO: #${pedido.id}\n`;
  txt += `DATA/HORA: ${pedido.data}\n`;

  if (pedido.condominio && pedido.condominio !== "Outros") {
    txt += `CONDOMINIO: ${pedido.condominio}\n`;
  } else {
    txt += `ENTREGA: ${pedido.outros || "Outro local"}\n`;
  }

  txt += `CASA/APTO: ${pedido.casa || "-"}\n`;
  txt += `PAGAMENTO: ${pedido.pagamento}\n`;

  // TROCO
  if (pedido.pagamento === "Dinheiro") {
    if (pedido.troco) {
      txt += `TROCO PARA: R$ ${Number(pedido.troco).toFixed(2)}\n`;
    } else {
      txt += "TROCO: NAO NECESSITA\n";
    }
  }

  if (pedido.observacao) {
    txt += "--------------------------------\n";
    txt += "OBSERVACOES:\n";
    txt += `${pedido.observacao}\n`;
  }

  txt += "--------------------------------\n";

  // =========================
  // ITENS
  // =========================
  txt += ESC + "E" + "\x01";
  txt += "ITENS DO PEDIDO\n";
  txt += ESC + "E" + "\x00";

  pedido.itens.forEach(i => {
    txt += `${i.qtd}x ${i.nome}\n`;
    txt += `   R$ ${(i.qtd * i.preco).toFixed(2)}\n`;
  });

  txt += "--------------------------------\n";

  // =========================
  // TOTAL
  // =========================
  txt += ESC + "E" + "\x01";
  txt += ESC + "a" + "\x01";
  txt += `TOTAL: R$ ${pedido.total.toFixed(2)}\n`;
  txt += ESC + "a" + "\x00";
  txt += ESC + "E" + "\x00";

  txt += "\n";
  txt += "OBRIGADO PELA PREFERENCIA!\n";
  txt += "--------------------------------\n\n\n";

  // =========================
  // CORTE DE PAPEL
  // =========================
  txt += GS + "V" + "\x00";

  fs.writeFileSync(IMPRESSORA, txt);
}

module.exports = imprimirPedido;
