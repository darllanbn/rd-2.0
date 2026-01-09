const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const moment = require('moment'); // npm install moment

const imprimirPedido = require('./impressao');

const app = express();
const db = new sqlite3.Database('./database.db');

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

/* ======================
   MULTER
====================== */
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

/* ======================
   BANCO
====================== */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT,
      preco REAL,
      estoque INTEGER,
      imagem TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT,
      condominio TEXT,
      casa TEXT,
      pagamento TEXT,
      obs TEXT,
      total REAL,
      status TEXT DEFAULT 'PENDENTE'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pedido_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER,
      produto TEXT,
      qtd INTEGER,
      preco REAL
    )
  `);
});

/* ======================
   ROTAS PRODUTOS
====================== */
app.get('/produtos', (_, res) => {
  db.all('SELECT * FROM produtos ORDER BY id DESC', (_, rows) => res.json(rows || []));
});

app.get('/admin/produtos', (_, res) => {
  db.all('SELECT * FROM produtos ORDER BY id DESC', (_, rows) => res.json(rows || []));
});

app.post('/admin/produto', upload.single('imagem'), (req, res) => {
  const { nome, preco, estoque } = req.body;
  const imagem = req.file ? '/uploads/' + req.file.filename : '';
  db.run(
    `INSERT INTO produtos (nome, preco, estoque, imagem) VALUES (?, ?, ?, ?)`,
    [nome, Number(preco), Number(estoque), imagem],
    () => res.json({ ok: true })
  );
});

app.put('/admin/produto/:id', upload.single('imagem'), (req, res) => {
  const id = req.params.id;
  const { nome, preco, estoque } = req.body;

  db.get(`SELECT * FROM produtos WHERE id = ?`, [id], (err, produto) => {
    if (err || !produto) return res.status(404).json({ erro: 'Produto não encontrado' });
    const imagem = req.file ? '/uploads/' + req.file.filename : produto.imagem;
    db.run(
      `UPDATE produtos SET nome = ?, preco = ?, estoque = ?, imagem = ? WHERE id = ?`,
      [nome, Number(preco), Number(estoque), imagem, id],
      err => {
        if (err) return res.status(500).json({ erro: 'Erro ao atualizar produto' });
        res.json({ ok: true });
      }
    );
  });
});

app.delete('/admin/produto/:id', (req, res) => {
  const id = req.params.id;
  db.run(`DELETE FROM produtos WHERE id = ?`, [id], err => {
    if (err) return res.status(500).json({ erro: 'Erro ao excluir produto' });
    res.json({ ok: true });
  });
});

/* ======================
   CRIAR PEDIDO
====================== */
app.post('/pedido', (req, res) => {
  const { carrinho, condominio, casa, pagamento, obs } = req.body;
  let total = 0;

  carrinho.forEach(item => {
    total += item.preco * item.qtd;
    db.run(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`, [item.qtd, item.id]);
  });

  db.run(
    `INSERT INTO pedidos (data, condominio, casa, pagamento, obs, total, status)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDENTE')`,
    [new Date().toLocaleString('pt-BR'), condominio, casa || '', pagamento, obs || '', total],
    function () {
      const pedidoId = this.lastID;
      carrinho.forEach(item => {
        db.run(
          `INSERT INTO pedido_itens (pedido_id, produto, qtd, preco) VALUES (?, ?, ?, ?)`,
          [pedidoId, item.nome, item.qtd, item.preco]
        );
      });
      res.json({ ok: true });
    }
  );
});

/* ======================
   PEDIDOS PENDENTES
====================== */
app.get('/admin/pedidos', (_, res) => {
  db.all(`SELECT * FROM pedidos WHERE status = 'PENDENTE' ORDER BY id DESC`, (_, pedidos) => {
    if (!pedidos.length) return res.json([]);
    const ids = pedidos.map(p => p.id).join(',');
    db.all(`SELECT * FROM pedido_itens WHERE pedido_id IN (${ids})`, (_, itens) => {
      pedidos.forEach(p => { p.itens = itens.filter(i => i.pedido_id === p.id); });
      res.json(pedidos);
    });
  });
});

/* ======================
   PEDIDOS IMPRESSOS
====================== */
app.get('/admin/pedidos-impressos', (_, res) => {
  db.all(`SELECT * FROM pedidos WHERE status = 'IMPRESSO' ORDER BY id DESC`, (_, pedidos) => {
    if (!pedidos.length) return res.json([]);
    const ids = pedidos.map(p => p.id).join(',');
    db.all(`SELECT * FROM pedido_itens WHERE pedido_id IN (${ids})`, (_, itens) => {
      pedidos.forEach(p => { p.itens = itens.filter(i => i.pedido_id === p.id); });
      res.json(pedidos);
    });
  });
});

/* ======================
   PDF PEDIDO
====================== */
app.get('/admin/pedidos/:id/pdf', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM pedidos WHERE id = ?`, [id], (_, pedido) => {
    if (!pedido) return res.sendStatus(404);
    db.all(`SELECT * FROM pedido_itens WHERE pedido_id = ?`, [id], (_, itens) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=pedido-${id}.pdf`);
      const doc = new PDFDocument({ size: [226, 800], margin: 10 });
      doc.pipe(res);
      doc.fontSize(14).text('RD DISTRIBUIDORA', { align: 'center' });
      doc.fontSize(10).text('---------------------------', { align: 'center' });
      doc.text(`Pedido: #${pedido.id}`);
      doc.text(`Data: ${pedido.data}`);
      doc.text(`Condomínio: ${pedido.condominio}`);
      doc.text(`Casa: ${pedido.casa}`);
      doc.text(`Pagamento: ${pedido.pagamento}`);
      if (pedido.obs) doc.text(`Obs: ${pedido.obs}`);
      doc.moveDown().text('ITENS');
      itens.forEach(i => { doc.text(`${i.qtd}x ${i.produto} - R$ ${(i.qtd * i.preco).toFixed(2)}`); });
      doc.moveDown();
      doc.text(`TOTAL: R$ ${pedido.total.toFixed(2)}`, { align: 'right' });
      doc.end();
    });
  });
});

/* ======================
   IMPRESSÃO AUTOMÁTICA
====================== */
app.post('/admin/pedidos/:id/imprimir', async (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM pedidos WHERE id = ?`, [id], async (_, pedido) => {
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
    db.all(`SELECT * FROM pedido_itens WHERE pedido_id = ?`, [id], async (_, itens) => {
      try {
        await imprimirPedido({
          id: pedido.id,
          data: pedido.data,
          cliente: pedido.condominio,
          casa: pedido.casa,
          pagamento: pedido.pagamento,
          observacao: pedido.obs,
          total: pedido.total,
          itens: itens.map(i => ({ nome: i.produto, qtd: i.qtd, preco: i.preco }))
        });
        db.run(`UPDATE pedidos SET status = 'IMPRESSO' WHERE id = ?`, [id], () => res.json({ ok: true }));
      } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao imprimir' });
      }
    });
  });
});

/* ======================
   DASHBOARD 📊
====================== */
app.get('/admin/dashboard-dados', (req, res) => {
  db.get(`SELECT COUNT(*) AS total FROM pedidos`, (_, total) => {
    db.get(`SELECT COUNT(*) AS impressos FROM pedidos WHERE status = 'IMPRESSO'`, (_, impressos) => {
      db.get(`SELECT COUNT(*) AS pendentes FROM pedidos WHERE status = 'PENDENTE'`, (_, pendentes) => {
        db.all(`
          SELECT condominio, COUNT(*) AS total
          FROM pedidos
          GROUP BY condominio
          ORDER BY total DESC
        `, (_, condominios) => {
          res.json({ total: total.total, impressos: impressos.impressos, pendentes: pendentes.pendentes, condominios });
        });
      });
    });
  });
});

/* ======================
   RELATÓRIO DIÁRIO PDF
====================== */
app.get('/admin/relatorio-diario', (req, res) => {
  const hoje = moment().format('DD/MM/YYYY');
  db.all(`SELECT * FROM pedidos WHERE data LIKE ? ORDER BY id ASC`, [`%${hoje}%`], (err, pedidos) => {
    if (err || !pedidos.length) return res.status(404).json({ erro: 'Nenhum pedido encontrado hoje' });
    const ids = pedidos.map(p => p.id).join(',');
    db.all(`SELECT * FROM pedido_itens WHERE pedido_id IN (${ids})`, (err, itens) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=relatorio-${hoje}.pdf`);
      const doc = new PDFDocument({ margin: 20, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(18).text(`📋 Relatório Diário - RD Distribuidora`, { align: 'center' });
      doc.fontSize(12).text(`Data: ${hoje}\n\n`, { align: 'center' });
      pedidos.forEach(p => {
        doc.fontSize(12).text(`Pedido #${p.id} - ${p.data}`);
        doc.text(`Condomínio: ${p.condominio} | Casa/Apto: ${p.casa}`);
        doc.text(`Pagamento: ${p.pagamento}`);
        if (p.obs) doc.text(`Obs: ${p.obs}`);
        doc.text('Itens:');
        itens.filter(i => i.pedido_id === p.id).forEach(i => {
          doc.text(`   - ${i.qtd}x ${i.produto} - R$ ${(i.qtd * i.preco).toFixed(2)}`);
        });
        doc.text(`Total: R$ ${p.total.toFixed(2)}`);
        doc.moveDown();
      });
      doc.end();
    });
  });
});

/* ======================
   APAGAR HISTÓRICO DO DIA
====================== */
app.delete('/admin/apagar-historico', (req, res) => {
  const hoje = moment().format('DD/MM/YYYY');
  db.all(`SELECT id FROM pedidos WHERE data LIKE ?`, [`%${hoje}%`], (err, pedidos) => {
    if (err || !pedidos.length) return res.status(404).json({ erro: 'Nenhum pedido encontrado hoje' });
    const ids = pedidos.map(p => p.id).join(',');
    db.run(`DELETE FROM pedido_itens WHERE pedido_id IN (${ids})`);
    db.run(`DELETE FROM pedidos WHERE id IN (${ids})`, err2 => {
      if (err2) return res.status(500).json({ erro: 'Erro ao apagar histórico' });
      res.json({ ok: true });
    });
  });
});

/* ======================
   SERVIDOR
====================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 RD Distribuidora rodando na porta ${PORT}`);
});
