const fs = require("fs");

const IMPRESSORA = "\\\\localhost\\ELGIN_I9";

const ESC = "\x1B";
const GS  = "\x1D";

function imprimirPedido(pedido) {

  let txt = "";

  // RESET
  txt += ESC + "@";

  // CABEÇALHO
  txt += ESC + "a" + "\x01"; // Centralizado
  txt += ESC + "E" + "\x01"; // Negrito
  txt += "RD DISTRIBUIDORA\n";
  txt += ESC + "E" + "\x00";
  txt += "AGUA • GAS • CONVENIENCIA\n";
  txt += "--------------------------------\n";

  // DADOS DO PEDIDO
  txt += ESC + "a" + "\x00"; // Esquerda
  txt += `PEDIDO N°: ${pedido.id}\n`;
  txt += `DATA/HORA: ${pedido.data}\n`;
  txt += `CONDOMÍNIO: ${pedido.cliente}\n`;
  txt += `CASA/APTO: ${pedido.casa || '-'}\n`;
  txt += `PAGAMENTO: ${pedido.pagamento}\n`;

  if (pedido.observacao) {
    txt += `OBS: ${pedido.observacao}\n`;
  }

  txt += "--------------------------------\n";
  txt += "ITENS\n";

  // ITENS
  pedido.itens.forEach(i => {
    txt += `${i.qtd}x ${i.nome}\n`;
    txt += `   R$ ${(i.qtd * i.preco).toFixed(2)}\n`;
  });

  txt += "--------------------------------\n";

  // TOTAL
  txt += ESC + "E" + "\x01";
  txt += `TOTAL: R$ ${pedido.total.toFixed(2)}\n`;
  txt += ESC + "E" + "\x00";

  txt += "\nOBRIGADO PELA PREFERENCIA!\n";
  txt += "VOLTE SEMPRE 😊\n";
  txt += "--------------------------------\n\n";

  // CORTE DE PAPEL
  txt += GS + "V" + "\x00";

  fs.writeFileSync(IMPRESSORA, txt);
}

module.exports = imprimirPedido;
