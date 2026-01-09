const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  // TABELA PRODUTOS
  db.run(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      preco REAL NOT NULL,
      estoque INTEGER NOT NULL,
      imagem TEXT NOT NULL
    )
  `);

  // TABELA PEDIDOS
  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      itens TEXT NOT NULL,
      total REAL NOT NULL,
      endereco TEXT NOT NULL,
      pagamento TEXT NOT NULL,
      data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Banco criado com sucesso');
});

db.close();
