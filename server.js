const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const moment = require('moment');
const { Pool } = require('pg');

const app = express();

/* ======================
   POSTGRES (RENDER)
====================== */
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ======================
   MIDDLEWARES
====================== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/admin', express.static('admin'));

/* ======================
   UPLOADS
====================== */
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

/* ======================
   BANCO
====================== */
async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      preco NUMERIC,
      estoque INTEGER,
      imagem TEXT
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      data TEXT,
      condominio TEXT,
      casa TEXT,
      pagamento TEXT,
      obs TEXT,
      total NUMERIC,
      status TEXT DEFAULT 'PENDENTE'
    );

    CREATE TABLE IF NOT EXISTS pedido_itens (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      produto TEXT,
      qtd INTEGER,
      preco NUMERIC
    );
  `);

  console.log('🗄️ PostgreSQL pronto');
}
initDB();

/* ======================
   PRODUTOS
====================== */
app.get('/produtos', async (_, res) => {
  const { rows } = await db.query('SELECT * FROM produtos ORDER BY id DESC');
  res.json(rows);
});

app.get('/admin/produtos', async (_, res) => {
  const { rows } = await db.query('SELECT * FROM produtos ORDER BY id DESC');
  res.json(rows);
});

app.post('/admin/produto', upload.single('imagem'), async (req, res) => {
  const { nome, preco, estoque } = req.body;
  const imagem = req.file ? '/uploads/' + req.file.filename : '';

  await db.query(
    'INSERT INTO produtos (nome, preco, estoque, imagem) VALUES ($1,$2,$3,$4)',
    [nome, preco, estoque, imagem]
  );

  res.json({ ok: true });
});
/* ======================
   ATUALIZAR PRODUTO
====================== */
app.put('/admin/produto/:id', upload.single('imagem'), async (req, res) => {
  const id = req.params.id;
  const { nome, preco, estoque } = req.body;

  const produtoRes = await db.query(
    'SELECT * FROM produtos WHERE id=$1',
    [id]
  );

  if (!produtoRes.rows.length) {
    return res.status(404).json({ erro: 'Produto não encontrado' });
  }

  const imagem = req.file
    ? '/uploads/' + req.file.filename
    : produtoRes.rows[0].imagem;

  await db.query(
    `UPDATE produtos
     SET nome=$1, preco=$2, estoque=$3, imagem=$4
     WHERE id=$5`,
    [nome, preco, estoque, imagem, id]
  );

  res.json({ ok: true });
});

/* ======================
   EXCLUIR PRODUTO
====================== */
app.delete('/admin/produto/:id', async (req, res) => {
  const id = req.params.id;

  await db.query(
    'DELETE FROM produtos WHERE id=$1',
    [id]
  );

  res.json({ ok: true });
});


/* ======================
   CRIAR PEDIDO
====================== */
app.post('/pedido', async (req, res) => {
  const { carrinho, condominio, casa, pagamento, obs } = req.body;
  let total = 0;

  for (const item of carrinho) {
    total += item.preco * item.qtd;
    await db.query(
      'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2',
      [item.qtd, item.id]
    );
  }

  const pedidoRes = await db.query(
    `INSERT INTO pedidos (data, condominio, casa, pagamento, obs, total)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      moment().format('DD/MM/YYYY HH:mm:ss'),
      condominio,
      casa || '',
      pagamento,
      obs || '',
      total
    ]
  );

  const pedidoId = pedidoRes.rows[0].id;

  for (const item of carrinho) {
    await db.query(
      `INSERT INTO pedido_itens (pedido_id, produto, qtd, preco)
       VALUES ($1,$2,$3,$4)`,
      [pedidoId, item.nome, item.qtd, item.preco]
    );
  }

  res.json({ ok: true });
});

/* ======================
   LISTAR PEDIDOS
====================== */
async function listarPedidos(status, res) {
  const pedidosRes = await db.query(
    'SELECT * FROM pedidos WHERE status=$1 ORDER BY id DESC',
    [status]
  );

  const pedidos = pedidosRes.rows;

  for (const p of pedidos) {
    const itensRes = await db.query(
      'SELECT produto, qtd, preco FROM pedido_itens WHERE pedido_id=$1',
      [p.id]
    );
    p.itens = itensRes.rows;
  }

  res.json(pedidos);
}

app.get('/admin/pedidos', (_, res) => listarPedidos('PENDENTE', res));
app.get('/admin/pedidos-impressos', (_, res) => listarPedidos('IMPRESSO', res));

/* ======================
   IMPRESSÃO TÉRMICA (CTRL+P)
====================== */
app.get('/admin/pedidos/:id/print', async (req, res) => {
  const id = req.params.id;

  const pedidoRes = await db.query(
    'SELECT * FROM pedidos WHERE id=$1',
    [id]
  );
  if (!pedidoRes.rows.length) return res.send('Pedido não encontrado');

  const itensRes = await db.query(
    'SELECT * FROM pedido_itens WHERE pedido_id=$1',
    [id]
  );

  const pedido = pedidoRes.rows[0];
  const itens = itensRes.rows;

  const precisaTroco =
    pedido.pagamento.toUpperCase().includes('DINHEIRO')
      ? `<div class="line">TROCO PARA: ________________________</div>`
      : '';

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pedido ${pedido.id}</title>

<style>
@page { size: 80mm auto; margin: 0; }

body {
  width: 80mm;
  margin: 0;
  padding: 6mm;
  font-family: Courier New, monospace;
  font-size: 12px;
  font-weight: bold;
  color: #000;
}

.center { text-align: center; }
.big { font-size: 14px; }
.hr { border-top: 1px dashed #000; margin: 6px 0; }
.item { display: flex; justify-content: space-between; }
.line { margin-top: 6px; }
</style>
</head>

<body onload="window.print()">

<div class="center big">RD DISTRIBUIDORA</div>
<div class="center">PEDIDO Nº ${pedido.id}</div>
<div class="center">${pedido.data}</div>

<div class="hr"></div>

<div class="center big">${pedido.condominio}</div>
<div class="center">CASA / APTO: ${pedido.casa || '-'}</div>

<div class="hr"></div>

<div class="center big">FORMA DE PAGAMENTO</div>
<div class="center">${pedido.pagamento}</div>

${precisaTroco}

<div class="hr"></div>

<div class="center">ITENS</div>

${itens.map(i => `
  <div class="item">
    <span>${i.qtd}x ${i.produto}</span>
    <span>R$ ${(i.qtd * i.preco).toFixed(2)}</span>
  </div>
`).join('')}

<div class="hr"></div>

<div class="center big">TOTAL: R$ ${Number(pedido.total).toFixed(2)}</div>

${pedido.obs ? `
<div class="hr"></div>
<div>OBS:<br>${pedido.obs}</div>
` : ''}

<div class="hr"></div>
<div class="center">OBRIGADO PELA PREFERÊNCIA</div>

</body>
</html>
  `);

  await db.query(`UPDATE pedidos SET status='IMPRESSO' WHERE id=$1`, [id]);
});

/* ======================
   APAGAR HISTÓRICO
====================== */
app.delete('/admin/apagar-historico', async (_, res) => {
  await db.query('DELETE FROM pedidos');
  res.json({ ok: true });
});

/* ======================
   SERVIDOR
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 RD Distribuidora ONLINE na porta ${PORT}`)
);
