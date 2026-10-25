// ===========================================================================
//   servidor.js  -  O SERVIDOR DA HMDF esports
//
//   A tela (navegador) pede, o servidor conversa com o banco (SQL) e
//   responde em JSON.
//
//   Cada tabela tem 4 pedidos:
//
//      GET     /api/alunos       listar
//      POST    /api/alunos       cadastrar
//      PUT     /api/alunos/3     alterar
//      DELETE  /api/alunos/3     excluir
//
//   Valem para:  alunos, treinadores, modalidades, prontuarios, matriculas
//   E mais dois de login:  POST /api/login/aluno  e  POST /api/login/treinador
//
//   O ID (1, 2, 3...) é criado pelo banco. O servidor só pega o número e
//   devolve na resposta em JSON.
//
//   Toda vez que algo muda, o servidor também atualiza o arquivo dados.json
//   com uma cópia de tudo que está no banco.
// ===========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const { executar, listar, buscarUm, pronto } = require('./banco');
const seguranca = require('./seguranca');

const PORTA = 3000;


// ---------------------------------------------------------------------------
//   FERRAMENTAS
// ---------------------------------------------------------------------------

// Responde com JSON
function enviar(resposta, codigo, dados) {
  resposta.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  resposta.end(JSON.stringify(dados));
}

// Lê o JSON que a tela enviou
function lerCorpo(pedido) {
  return new Promise((certo) => {
    let texto = '';
    pedido.on('data', (pedaco) => { texto += pedaco; });
    pedido.on('end', () => {
      try { certo(JSON.parse(texto)); }
      catch (e) { certo({}); }
    });
  });
}

// Confere se os campos obrigatórios chegaram preenchidos.
// Exemplo:  exigir(dados, { nome: 'o nome', cpf: 'o CPF' })
function exigir(dados, campos) {
  for (const campo in campos) {
    if (!String(dados[campo] || '').trim()) {
      throw new Error('Preencha ' + campos[campo] + '.');
    }
  }
}

// O banco responde em inglês. Aqui trocamos pelas frases em português.
function traduzirErro(mensagem) {
  if (mensagem.includes('aluno.cpf'))              return 'Já existe um aluno com esse CPF.';
  if (mensagem.includes('treinador.cdedf'))        return 'Já existe um treinador com esse CREF.';
  if (mensagem.includes('treinador.login'))        return 'Já existe um treinador com esse e-mail.';
  if (mensagem.includes('alunomodalidade'))        return 'Esse aluno já está nessa modalidade.';
  if (mensagem.includes('UNIQUE'))                 return 'Esse registro já existe.';
  if (mensagem.includes('FOREIGN KEY'))            return 'Não dá para excluir: este registro está sendo usado em outra tabela.';
  return mensagem;
}

// Roda o que a rota pediu. Se der erro, responde com a frase do erro.
async function tentar(resposta, trabalho) {
  try {
    const resultado = await trabalho();
    enviar(resposta, 200, resultado);
  } catch (erro) {
    enviar(resposta, 400, { erro: traduzirErro(erro.message) });
  }
}

// Se UPDATE ou DELETE não mudou nenhuma linha, esse id não existe.
function conferirMudou(resultado) {
  if (resultado.mudou === 0) throw new Error('Esse registro não existe.');
}


// ---------------------------------------------------------------------------
//   O ARQUIVO dados.json
//   Uma cópia de tudo que está no banco. Atualizada a cada mudança.
//   (A senha do treinador nunca vai para o arquivo.)
// ---------------------------------------------------------------------------

async function salvarJson() {
  const copia = {
    alunos:      await listar('SELECT * FROM aluno'),
    treinadores: await listar('SELECT id, cdedf, nome, login, especialidade, telefone FROM treinador'),
    modalidades: await listar('SELECT * FROM modalidade'),
    prontuarios: await listar('SELECT * FROM prontuario'),
    matriculas:  await listar('SELECT * FROM alunomodalidade')
  };
  fs.writeFileSync(path.join(__dirname, 'dados.json'), JSON.stringify(copia, null, 2));
}


// ---------------------------------------------------------------------------
//   O SERVIDOR
// ---------------------------------------------------------------------------

const servidor = http.createServer(async (pedido, resposta) => {

  // '/api/alunos/3'  ->  ['', 'api', 'alunos', '3']
  const partes = pedido.url.split('?')[0].split('/');
  const recurso = partes[2];
  const id = partes[3];
  const metodo = pedido.method;


  // ======================= ARQUIVOS DA PASTA public =======================
  if (partes[1] !== 'api') {

    const endereco = pedido.url.split('?')[0] === '/' ? '/index.html' : pedido.url.split('?')[0];
    const publica = path.join(__dirname, 'public');
    const arquivo = path.join(publica, endereco);

    if (metodo !== 'GET' || !arquivo.startsWith(publica) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      resposta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      resposta.end('Não achei o arquivo ' + endereco);
      return;
    }

    const tipos = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    resposta.writeHead(200, { 'Content-Type': (tipos[path.extname(arquivo)] || 'text/plain') + '; charset=utf-8' });
    resposta.end(fs.readFileSync(arquivo));
    return;
  }


  // ============================== ALUNOS ==================================

  if (recurso === 'alunos' && metodo === 'GET') {
    return tentar(resposta, () => listar('SELECT * FROM aluno ORDER BY nome'));
  }

  if (recurso === 'alunos' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { nome: 'o nome', cpf: 'o CPF', login: 'o e-mail', cidade: 'a cidade', telefone: 'o telefone', cep: 'o CEP' });

      // Repare: não mandamos o id. O banco cria sozinho.
      const r = await executar(
        'INSERT INTO aluno (nome, cpf, login, cidade, telefone, cep) VALUES (?, ?, ?, ?, ?, ?)',
        [d.nome.trim(), d.cpf, d.login.trim(), d.cidade.trim(), d.telefone, d.cep]
      );
      await salvarJson();
      return { id: r.id };   // este é o ID de matrícula do aluno
    });
  }

  if (recurso === 'alunos' && metodo === 'PUT' && id) {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { nome: 'o nome', cpf: 'o CPF', login: 'o e-mail', cidade: 'a cidade', telefone: 'o telefone', cep: 'o CEP' });

      const r = await executar(
        'UPDATE aluno SET nome = ?, cpf = ?, login = ?, cidade = ?, telefone = ?, cep = ? WHERE id = ?',
        [d.nome.trim(), d.cpf, d.login.trim(), d.cidade.trim(), d.telefone, d.cep, id]
      );
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }

  if (recurso === 'alunos' && metodo === 'DELETE' && id) {
    return tentar(resposta, async () => {
      const r = await executar('DELETE FROM aluno WHERE id = ?', [id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }


  // ============================ TREINADORES ===============================

  if (recurso === 'treinadores' && metodo === 'GET') {
    // A senha não sai do servidor.
    return tentar(resposta, () => listar(
      'SELECT id, cdedf, nome, login, especialidade, telefone FROM treinador ORDER BY nome'
    ));
  }

  if (recurso === 'treinadores' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { nome: 'o nome', cdedf: 'o CREF', login: 'o e-mail', especialidade: 'a modalidade principal', telefone: 'o telefone', senha: 'a senha' });
      if (d.senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

      const r = await executar(
        'INSERT INTO treinador (cdedf, nome, login, especialidade, telefone, senha) VALUES (?, ?, ?, ?, ?, ?)',
        [d.cdedf.trim(), d.nome.trim(), d.login.trim().toLowerCase(), d.especialidade.trim(), d.telefone, seguranca.gerarHash(d.senha)]
      );
      await salvarJson();
      return { id: r.id };
    });
  }

  if (recurso === 'treinadores' && metodo === 'PUT' && id) {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { nome: 'o nome', cdedf: 'o CREF', login: 'o e-mail', especialidade: 'a modalidade principal', telefone: 'o telefone' });

      let r;
      if (d.senha) {
        // Se veio senha nova, troca. Se veio vazia, mantém a antiga.
        if (d.senha.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
        r = await executar(
          'UPDATE treinador SET cdedf = ?, nome = ?, login = ?, especialidade = ?, telefone = ?, senha = ? WHERE id = ?',
          [d.cdedf.trim(), d.nome.trim(), d.login.trim().toLowerCase(), d.especialidade.trim(), d.telefone, seguranca.gerarHash(d.senha), id]
        );
      } else {
        r = await executar(
          'UPDATE treinador SET cdedf = ?, nome = ?, login = ?, especialidade = ?, telefone = ? WHERE id = ?',
          [d.cdedf.trim(), d.nome.trim(), d.login.trim().toLowerCase(), d.especialidade.trim(), d.telefone, id]
        );
      }
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }

  if (recurso === 'treinadores' && metodo === 'DELETE' && id) {
    return tentar(resposta, async () => {
      const r = await executar('DELETE FROM treinador WHERE id = ?', [id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }


  // ============================ MODALIDADES ===============================

  if (recurso === 'modalidades' && metodo === 'GET') {
    return tentar(resposta, () => listar('SELECT * FROM modalidade ORDER BY esporte, agenda'));
  }

  if (recurso === 'modalidades' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { esporte: 'o esporte', turno: 'o turno', turma: 'a turma', agenda: 'o dia da semana' });

      const r = await executar(
        'INSERT INTO modalidade (esporte, turno, turma, agenda) VALUES (?, ?, ?, ?)',
        [d.esporte.trim(), d.turno, d.turma.trim(), d.agenda]
      );
      await salvarJson();
      return { id: r.id };
    });
  }

  if (recurso === 'modalidades' && metodo === 'PUT' && id) {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { esporte: 'o esporte', turno: 'o turno', turma: 'a turma', agenda: 'o dia da semana' });

      const r = await executar(
        'UPDATE modalidade SET esporte = ?, turno = ?, turma = ?, agenda = ? WHERE id = ?',
        [d.esporte.trim(), d.turno, d.turma.trim(), d.agenda, id]
      );
      conferirMudou(r);

      // As matrículas guardam uma cópia do esporte e do turno. Atualizamos junto.
      await executar(
        'UPDATE alunomodalidade SET modalidade_esporte = ?, modalidade_turno = ? WHERE modalidade_id = ?',
        [d.esporte.trim(), d.turno, id]
      );
      await salvarJson();
      return { id: Number(id) };
    });
  }

  if (recurso === 'modalidades' && metodo === 'DELETE' && id) {
    return tentar(resposta, async () => {
      // Se tiver aluno matriculado, a FOREIGN KEY do banco recusa aqui.
      const r = await executar('DELETE FROM modalidade WHERE id = ?', [id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }


  // ============================ PRONTUARIOS ===============================

  if (recurso === 'prontuarios' && metodo === 'GET') {
    return tentar(resposta, () => listar('SELECT * FROM prontuario ORDER BY id'));
  }

  if (recurso === 'prontuarios' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { avm: 'o campo AVM', am: 'o campo AM' });

      const r = await executar('INSERT INTO prontuario (avm, am) VALUES (?, ?)', [d.avm.trim(), d.am.trim()]);
      await salvarJson();
      return { id: r.id };
    });
  }

  if (recurso === 'prontuarios' && metodo === 'PUT' && id) {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { avm: 'o campo AVM', am: 'o campo AM' });

      const r = await executar('UPDATE prontuario SET avm = ?, am = ? WHERE id = ?', [d.avm.trim(), d.am.trim(), id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }

  if (recurso === 'prontuarios' && metodo === 'DELETE' && id) {
    return tentar(resposta, async () => {
      const r = await executar('DELETE FROM prontuario WHERE id = ?', [id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }


  // ============================ MATRICULAS ================================
  // (a tabela alunomodalidade: liga o aluno à modalidade)

  if (recurso === 'matriculas' && metodo === 'GET') {
    // INNER JOIN: junta a matrícula com o aluno para mostrar o NOME e o CPF
    return tentar(resposta, () => listar(`
      SELECT alunomodalidade.id,
             alunomodalidade.modalidade_esporte AS esporte,
             alunomodalidade.modalidade_turno   AS turno,
             aluno.nome AS aluno,
             aluno.cpf  AS cpf
        FROM alunomodalidade
        INNER JOIN aluno ON alunomodalidade.aluno_id = aluno.id
       ORDER BY alunomodalidade.modalidade_esporte, aluno.nome
    `));
  }

  if (recurso === 'matriculas' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      exigir(d, { aluno_id: 'o atleta', modalidade_id: 'a modalidade' });

      // Buscamos a modalidade para copiar o esporte e o turno dela.
      const modalidade = await buscarUm('SELECT esporte, turno FROM modalidade WHERE id = ?', [d.modalidade_id]);
      if (!modalidade) throw new Error('Essa modalidade não existe.');

      const r = await executar(
        'INSERT INTO alunomodalidade (aluno_id, modalidade_id, modalidade_turno, modalidade_esporte) VALUES (?, ?, ?, ?)',
        [d.aluno_id, d.modalidade_id, modalidade.turno, modalidade.esporte]
      );
      await salvarJson();
      return { id: r.id };
    });
  }

  if (recurso === 'matriculas' && metodo === 'DELETE' && id) {
    return tentar(resposta, async () => {
      const r = await executar('DELETE FROM alunomodalidade WHERE id = ?', [id]);
      conferirMudou(r);
      await salvarJson();
      return { id: Number(id) };
    });
  }


  // =============================== LOGIN ==================================

  // O aluno entra com o CPF e o ID de matrícula (o número que o banco criou).
  if (recurso === 'login' && id === 'aluno' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      const aluno = await buscarUm('SELECT id, nome FROM aluno WHERE cpf = ? AND id = ?', [d.cpf, d.id]);

      // A mesma frase para CPF errado e ID errado, para não dar pista.
      if (!aluno) throw new Error('CPF ou ID de matrícula incorretos.');
      return aluno;
    });
  }

  // O treinador entra com o e-mail e a senha.
  if (recurso === 'login' && id === 'treinador' && metodo === 'POST') {
    return tentar(resposta, async () => {
      const d = await lerCorpo(pedido);
      const treinador = await buscarUm(
        'SELECT id, nome, senha FROM treinador WHERE login = ?',
        [String(d.email || '').trim().toLowerCase()]
      );

      if (!treinador || !seguranca.conferirSenha(String(d.senha || ''), treinador.senha)) {
        throw new Error('E-mail ou senha incorretos.');
      }
      return { id: treinador.id, nome: treinador.nome };
    });
  }


  // Nenhuma rota reconheceu o pedido
  enviar(resposta, 404, { erro: 'Não conheço ' + metodo + ' ' + pedido.url });
});


// Só liga o servidor depois que o banco estiver pronto.
pronto.then(async () => {
  await salvarJson();
  servidor.listen(PORTA, () => {
    console.log('');
    console.log('  HMDF esports no ar:  http://localhost:' + PORTA);
    console.log('  Para parar: Ctrl + C');
    console.log('');
  });
}).catch((erro) => {
  console.log('Erro ao preparar o banco:', erro.message);
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.log('  A porta ' + PORTA + ' já está em uso. Feche o outro terminal que está com o servidor aberto.');
  } else {
    throw erro;
  }
});
