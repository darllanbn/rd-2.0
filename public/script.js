const produtosDiv = document.getElementById('produtos');
const carrinhoDiv = document.getElementById('carrinho');
const totalSpan = document.getElementById('total');
const btnFinalizar = document.querySelector('.btn-finalizar');

let carrinho = [];

/* ======================
   CARREGAR PRODUTOS
====================== */
fetch('/produtos')
  .then(res => {
    if (!res.ok) throw new Error('Erro ao buscar produtos');
    return res.json();
  })
  .then(produtos => {
    produtosDiv.innerHTML = '';

    produtos.forEach(p => {
      const div = document.createElement('div');
      div.className = 'produto-card';

      div.innerHTML = `
        <img src="${p.imagem}" alt="${p.nome}">
        <h3>${p.nome}</h3>
        <p class="preco">R$ ${Number(p.preco).toFixed(2)}</p>
        <p class="estoque">
          ${p.estoque > 0 ? `Estoque: ${p.estoque}` : 'Indisponível'}
        </p>
        <button 
          ${p.estoque <= 0 ? 'disabled' : ''}
          onclick="adicionar(${p.id}, '${p.nome}', ${p.preco})">
          Adicionar
        </button>
      `;

      produtosDiv.appendChild(div);
    });
  })
  .catch(err => {
    console.error(err);
    alert('Erro ao carregar produtos');
  });

/* ======================
   ADICIONAR AO CARRINHO
====================== */
function adicionar(id, nome, preco) {
  const item = carrinho.find(i => i.id === id);

  if (item) {
    item.qtd++;
  } else {
    carrinho.push({ id, nome, preco, qtd: 1 });
  }

  atualizarCarrinho();
}

/* ======================
   ATUALIZAR CARRINHO
====================== */
function atualizarCarrinho() {
  carrinhoDiv.innerHTML = '';
  let total = 0;

  carrinho.forEach(item => {
    total += item.preco * item.qtd;

    const div = document.createElement('div');
    div.className = 'carrinho-item';

    div.innerHTML = `
      <span>${item.nome} x${item.qtd}</span>
      <div>
        <button onclick="diminuir(${item.id})">➖</button>
        <button onclick="remover(${item.id})">❌</button>
      </div>
    `;

    carrinhoDiv.appendChild(div);
  });

  totalSpan.innerText = total.toFixed(2);

  btnFinalizar.disabled = carrinho.length === 0;
  btnFinalizar.style.opacity = carrinho.length === 0 ? '0.6' : '1';
}

/* ======================
   DIMINUIR QUANTIDADE
====================== */
function diminuir(id) {
  const item = carrinho.find(i => i.id === id);
  if (!item) return;

  item.qtd--;
  if (item.qtd <= 0) {
    carrinho = carrinho.filter(i => i.id !== id);
  }

  atualizarCarrinho();
}

/* ======================
   REMOVER ITEM
====================== */
function remover(id) {
  carrinho = carrinho.filter(i => i.id !== id);
  atualizarCarrinho();
}

/* ======================
   FINALIZAR PEDIDO
====================== */
function finalizar() {
  const condominio = document.getElementById('condominio').value;
  const casa = document.getElementById('casa').value;
  const pagamento = document.getElementById('pagamento').value;
  const obs = document.getElementById('obs').value;

  if (!condominio || !pagamento) {
    alert('Preencha o condomínio e a forma de pagamento');
    return;
  }

  if (carrinho.length === 0) {
    alert('Seu carrinho está vazio');
    return;
  }

  const horaPedido = new Date().toLocaleString('pt-BR');

  fetch('/pedido', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrinho,
      condominio,
      casa,
      pagamento,
      obs
    })
  })
    .then(res => {
      if (!res.ok) throw new Error('Erro no servidor');
      return res.json();
    })
    .then(() => {
      alert('Pedido enviado com sucesso!');

      // Montar mensagem profissional para WhatsApp
      let itensTexto = '';
      carrinho.forEach((item, i) => {
        itensTexto += `${i+1}. ${item.nome} x${item.qtd} - R$ ${(item.qtd * item.preco).toFixed(2)}\n`;
      });

      const total = carrinho.reduce((t, i) => t + i.preco * i.qtd, 0).toFixed(2);

      const texto = encodeURIComponent(
`🛒 *Novo Pedido - RD Distribuidora* 🛒
🕒 Hora: ${horaPedido}
🏢 Condomínio: ${condominio}
🏠 Casa/Apto: ${casa || '-'}
💳 Pagamento: ${pagamento}

📝 *Itens:*
${itensTexto}
💰 *Total: R$ ${total}*

📌 Observações: ${obs || '-'}

✅ Pedido recebido automaticamente!`
      );

      // Abrir WhatsApp
      window.open(`https://wa.me/5569992575592?text=${texto}`, '_blank');

      // Limpar carrinho
      carrinho = [];
      atualizarCarrinho();
    })
    .catch(err => {
      console.error(err);
      alert('Erro ao enviar pedido');
    });
}
