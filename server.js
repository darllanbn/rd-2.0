const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { Pool } = require('pg');

const imprimirPedido = require('./impressao');

const app = express();

/* ======================
   POSTGRES
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
   CRIAR TABELAS
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

app.put('/admin/produto/:id', upload.single('imagem'), async (req, res) => {
  const { id } = req.params;
  const { nome, preco, estoque } = req.body;

  const produto = await db.query('SELECT * FROM produtos WHERE id=$1', [id]);
  if (!produto.rows.length) return res.status(404).json({ erro: 'Produto não encontrado' });

  const imagem = req.file ? '/uploads/' + req.file.filename : produto.rows[0].imagem;

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
  const { carrinho, condominio, casa, pagamento, obs } = req.body;
  let total = 0;

  for (const item of carrinho) {
    total += item.preco * item.qtd;
    await db.query(
      'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2',
      [item.qtd, item.id]
    );
  }

  const pedido = await db.query(
    `INSERT INTO pedidos (data, condominio, casa, pagamento, obs, total)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [new Date().toLocaleString('pt-BR'), condominio, casa || '', pagamento, obs || '', total]
  );

  for (const item of carrinho) {
    await db.query(
      `INSERT INTO pedido_itens (pedido_id, produto, qtd, preco)
       VALUES ($1,$2,$3,$4)`,
      [pedido.rows[0].id, item.nome, item.qtd, item.preco]
    );
  }

  res.json({ ok: true });
});

/* ======================
   PEDIDOS
====================== */
async function listarPedidos(status, res) {
  const pedidos = await db.query(
    'SELECT * FROM pedidos WHERE status=$1 ORDER BY id DESC',
    [status]
  );
  if (!pedidos.rows.length) return res.json([]);

  const ids = pedidos.rows.map(p => p.id);
  const itens = await db.query(
    'SELECT * FROM pedido_itens WHERE pedido_id = ANY($1)',
    [ids]
  );

  pedidos.rows.forEach(p => {
    p.itens = itens.rows.filter(i => i.pedido_id === p.id);
  });

  res.json(pedidos.rows);
}

app.get('/admin/pedidos', (_, res) => listarPedidos('PENDENTE', res));
app.get('/admin/pedidos-impressos', (_, res) => listarPedidos('IMPRESSO', res));

/* ======================
   PDF PEDIDO
====================== */
app.get('/admin/pedidos/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const pedido = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
  if (!pedido.rows.length) return res.sendStatus(404);

  const itens = await db.query('SELECT * FROM pedido_itens WHERE pedido_id=$1', [id]);

  res.setHeader('Content-Type', 'application/pdf');
  const doc = new PDFDocument({ size: [226, 800], margin: 10 });
  doc.pipe(res);

  doc.fontSize(14).text('RD DISTRIBUIDORA', { align: 'center' });
  doc.text(`Pedido #${id}`);
  doc.text(`Data: ${pedido.rows[0].data}`);
  doc.text(`Condomínio: ${pedido.rows[0].condominio}`);
  doc.text(`Casa: ${pedido.rows[0].casa}`);
  doc.text(`Pagamento: ${pedido.rows[0].pagamento}`);
  if (pedido.rows[0].obs) doc.text(`Obs: ${pedido.rows[0].obs}`);

  doc.moveDown().text('ITENS');
  itens.rows.forEach(i =>
    doc.text(`${i.qtd}x ${i.produto} - R$ ${(i.qtd * i.preco).toFixed(2)}`)
  );

  doc.text(`TOTAL: R$ ${pedido.rows[0].total.toFixed(2)}`, { align: 'right' });
  doc.end();
});

/* ======================
   IMPRESSÃO
====================== */
app.post('/admin/pedidos/:id/imprimir', async (req, res) => {
  const { id } = req.params;
  const pedido = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
  const itens = await db.query('SELECT * FROM pedido_itens WHERE pedido_id=$1', [id]);

  await imprimirPedido({
    ...pedido.rows[0],
    itens: itens.rows
  });

  await db.query(`UPDATE pedidos SET status='IMPRESSO' WHERE id=$1`, [id]);
  res.json({ ok: true });
});

/* ======================
   DASHBOARD
====================== */
app.get('/admin/dashboard-dados', async (_, res) => {
  const total = await db.query('SELECT COUNT(*) FROM pedidos');
  const impressos = await db.query(`SELECT COUNT(*) FROM pedidos WHERE status='IMPRESSO'`);
  const pendentes = await db.query(`SELECT COUNT(*) FROM pedidos WHERE status='PENDENTE'`);
  const condominios = await db.query(`
    SELECT condominio, COUNT(*) AS total
    FROM pedidos GROUP BY condominio ORDER BY total DESC
  `);

  res.json({
    total: total.rows[0].count,
    impressos: impressos.rows[0].count,
    pendentes: pendentes.rows[0].count,
    condominios: condominios.rows
  });
});

/* ======================
   APAGAR HISTÓRICO DO DIA
====================== */
app.delete('/admin/apagar-historico', async (_, res) => {
  const hoje = moment().format('DD/MM/YYYY');
  await db.query(`DELETE FROM pedidos WHERE data LIKE $1`, [`%${hoje}%`]);
  res.json({ ok: true });
});

/* ======================
   SERVIDOR
====================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 RD Distribuidora ONLINE na porta ${PORT}`)
);
