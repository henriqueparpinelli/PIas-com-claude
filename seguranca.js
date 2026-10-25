// Guarda a senha do treinador "embaralhada", para ninguém conseguir ler
// a senha de verdade olhando o banco. Usa só o módulo crypto, que já vem no Node.

const crypto = require('crypto');

// "123456"  ->  "pedaco-aleatorio:embaralhado"
function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 32).toString('hex');
  return sal + ':' + hash;
}

// Confere a senha digitada com a que está guardada
function conferirSenha(senha, guardado) {
  const partes = String(guardado).split(':');
  if (partes.length !== 2) return false;
  const esperado = Buffer.from(partes[1], 'hex');
  const obtido = crypto.scryptSync(senha, partes[0], 32);
  return esperado.length === obtido.length && crypto.timingSafeEqual(esperado, obtido);
}

module.exports = { gerarHash, conferirSenha };
