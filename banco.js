// ===========================================================================
//   banco.js  -  O BANCO DE DADOS (SQL)
//
//   Tabelas:  aluno, treinador, modalidade, prontuario, alunomodalidade
//
//   Em todas, o  id  é  INTEGER PRIMARY KEY AUTOINCREMENT:
//   quem cria o número (1, 2, 3...) é o banco, sozinho. Ninguém digita.
// ===========================================================================

const sqlite3 = require('sqlite3');
const path = require('path');
const seguranca = require('./seguranca');

const banco = new sqlite3.Database(path.join(__dirname, 'banco.db'));


// Três ajudantes para falar com o banco usando  await.

// INSERT, UPDATE, DELETE  ->  devolve { id: número criado, mudou: linhas alteradas }
function executar(sql, valores = []) {
  return new Promise((certo, errado) => {
    banco.run(sql, valores, function (erro) {
      if (erro) errado(erro);
      else certo({ id: this.lastID, mudou: this.changes });
    });
  });
}

// SELECT que devolve várias linhas
function listar(sql, valores = []) {
  return new Promise((certo, errado) => {
    banco.all(sql, valores, (erro, linhas) => (erro ? errado(erro) : certo(linhas)));
  });
}

// SELECT que devolve uma linha só (ou nada)
function buscarUm(sql, valores = []) {
  return new Promise((certo, errado) => {
    banco.get(sql, valores, (erro, linha) => (erro ? errado(erro) : certo(linha)));
  });
}


async function preparar() {

  // Sem esta linha, as FOREIGN KEY não protegem nada.
  await executar('PRAGMA foreign_keys = ON');

  await executar(`
    CREATE TABLE IF NOT EXISTS aluno (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT NOT NULL,
      cpf       TEXT NOT NULL UNIQUE,
      login     TEXT NOT NULL,
      cidade    TEXT NOT NULL,
      telefone  TEXT NOT NULL,
      cep       TEXT NOT NULL
    )
  `);

  await executar(`
    CREATE TABLE IF NOT EXISTS treinador (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cdedf          TEXT NOT NULL UNIQUE,
      nome           TEXT NOT NULL,
      login          TEXT NOT NULL UNIQUE,
      especialidade  TEXT NOT NULL,
      telefone       TEXT NOT NULL,
      senha          TEXT NOT NULL
    )
  `);

  await executar(`
    CREATE TABLE IF NOT EXISTS modalidade (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      esporte  TEXT NOT NULL,
      turno    TEXT NOT NULL,
      turma    TEXT NOT NULL,
      agenda   TEXT NOT NULL,
      UNIQUE (esporte, turno, turma, agenda)
    )
  `);

  await executar(`
    CREATE TABLE IF NOT EXISTS prontuario (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      avm  TEXT NOT NULL,
      am   TEXT NOT NULL
    )
  `);

  // Liga o aluno à modalidade (um aluno pode fazer várias modalidades).
  await executar(`
    CREATE TABLE IF NOT EXISTS alunomodalidade (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id            INTEGER NOT NULL,
      modalidade_id       INTEGER NOT NULL,
      modalidade_turno    TEXT NOT NULL,
      modalidade_esporte  TEXT NOT NULL,
      FOREIGN KEY (aluno_id)      REFERENCES aluno(id),
      FOREIGN KEY (modalidade_id) REFERENCES modalidade(id),
      UNIQUE (aluno_id, modalidade_id)
    )
  `);


  // Dados de exemplo, só na primeira vez
  const existe = await buscarUm('SELECT COUNT(*) AS quantos FROM aluno');
  if (existe.quantos === 0) {

    await executar(
      'INSERT INTO aluno (nome, cpf, login, cidade, telefone, cep) VALUES (?, ?, ?, ?, ?, ?)',
      ['Henrique da Motinha', '123.456.789-09', 'henrique@gmail.com', 'Foz do Iguaçu', '(45) 98888-0001', '85851-000']
    );

    await executar(
      'INSERT INTO treinador (cdedf, nome, login, especialidade, telefone, senha) VALUES (?, ?, ?, ?, ?, ?)',
      ['030000-G/PR', 'Jair', 'jair@hmdfesports.com', 'Basquete', '(45) 99999-0001', seguranca.gerarHash('123456')]
    );

    await executar(
      'INSERT INTO modalidade (esporte, turno, turma, agenda) VALUES (?, ?, ?, ?)',
      ['Basquete', 'noite', '2A', 'quarta-feira']
    );

    await executar('INSERT INTO prontuario (avm, am) VALUES (?, ?)', ['em dia', 'aprovada']);

    await executar(
      'INSERT INTO alunomodalidade (aluno_id, modalidade_id, modalidade_turno, modalidade_esporte) VALUES (?, ?, ?, ?)',
      [1, 1, 'noite', 'Basquete']
    );

    console.log('  Dados de exemplo criados.');
    console.log('  Aluno de teste:      CPF 123.456.789-09   ID 1');
    console.log('  Treinador de teste:  jair@hmdfesports.com   senha 123456');
  }
}

// O servidor espera esta promessa terminar antes de ligar.
const pronto = preparar();

module.exports = { executar, listar, buscarUm, pronto };
