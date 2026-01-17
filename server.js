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
      tipo_entrega TEXT,
      entrega TEXT,
      pagamento TEXT,
      troco NUMERIC,
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

app.put('/admin/produto/:id', upload.single('imagem'), async (req, res) => {
  const { id } = req.params;
  const { nome, preco, estoque } = req.body;

  const produto = await db.query('SELECT * FROM produtos WHERE id=$1', [id]);
  if (!produto.rows.length) return res.sendStatus(404);

  const imagem = req.file
    ? '/uploads/' + req.file.filename
    : produto.rows[0].imagem;

  await db.query(
    'UPDATE produtos SET nome=$1, preco=$2, estoque=$3, imagem=$4 WHERE id=$5',
    [nome, preco, estoque, imagem, id]
  );

  res.json({ ok: true });
});

app.delete('/admin/produto/:id', async (req, res) => {
  await db.query('DELETE FROM produtos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ======================
   CRIAR PEDIDO
====================== */
app.post('/pedido', async (req, res) => {
  const {
    carrinho,
    tipoEntrega,
    entrega,
    pagamento,
    troco,
    obs
  } = req.body;

  let total = 0;

  for (const item of carrinho) {
    total += item.preco * item.qtd;
    await db.query(
      'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2',
      [item.qtd, item.id]
    );
  }

  const pedidoRes = await db.query(
    `INSERT INTO pedidos
     (data, tipo_entrega, entrega, pagamento, troco, obs, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      moment().format('DD/MM/YYYY HH:mm:ss'),
      tipoEntrega,
      entrega,
      pagamento,
      troco || null,
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
  const pedidos = (await db.query(
    'SELECT * FROM pedidos WHERE status=$1 ORDER BY id DESC',
    [status]
  )).rows;

  for (const p of pedidos) {
    p.itens = (await db.query(
      'SELECT produto, qtd, preco FROM pedido_itens WHERE pedido_id=$1',
      [p.id]
    )).rows;
  }

  res.json(pedidos);
}

app.get('/admin/pedidos', (_, res) => listarPedidos('PENDENTE', res));
app.get('/admin/pedidos-impressos', (_, res) => listarPedidos('IMPRESSO', res));

/* ======================
   IMPRESSÃO TÉRMICA
====================== */
app.get('/admin/pedidos/:id/print', async (req, res) => {
  const id = req.params.id;

  const pedido = (await db.query(
    'SELECT * FROM pedidos WHERE id=$1',
    [id]
  )).rows[0];

  if (!pedido) return res.send('Pedido não encontrado');

  const itens = (await db.query(
    'SELECT * FROM pedido_itens WHERE pedido_id=$1',
    [id]
  )).rows;

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
}
.center { text-align: center; }
.hr { border-top: 1px dashed #000; margin: 6px 0; }
.item { display: flex; justify-content: space-between; }
.big { font-size: 14px; }
</style>
</head>
<body onload="window.print()">

<div class="center big">RD DISTRIBUIDORA</div>
<div class="center">PEDIDO Nº ${pedido.id}</div>
<div class="center">${pedido.data}</div>

<div class="hr"></div>

<div class="center big">ENTREGA</div>
<div class="center">${pedido.entrega}</div>

<div class="hr"></div>

<div class="center big">PAGAMENTO</div>
<div class="center">${pedido.pagamento}</div>

${pedido.troco ? `<div class="center">TROCO PARA: R$ ${Number(pedido.troco).toFixed(2)}</div>` : ''}

<div class="hr"></div>

${itens.map(i => `
<div class="item">
  <span>${i.qtd}x ${i.produto}</span>
  <span>R$ ${(i.qtd * i.preco).toFixed(2)}</span>
</div>
`).join('')}

<div class="hr"></div>
<div class="center big">TOTAL: R$ ${Number(pedido.total).toFixed(2)}</div>

${pedido.obs ? `<div class="hr"></div><div>OBS: ${pedido.obs}</div>` : ''}

<div class="hr"></div>
<div class="center">OBRIGADO PELA PREFERÊNCIA</div>

</body>
</html>
  `);

  await db.query(`UPDATE pedidos SET status='IMPRESSO' WHERE id=$1`, [id]);
});

/* ======================
   SERVIDOR
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 RD Distribuidora ONLINE na porta ${PORT}`)
);
