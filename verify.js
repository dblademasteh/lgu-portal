// RS256 id_token verification against the portal's JWKS.
const { createPublicKey, createVerify } = require('crypto');
const fs = require('fs');

const toks = JSON.parse(fs.readFileSync('./r.json', 'utf8'));
const jwks = JSON.parse(fs.readFileSync('./j.json', 'utf8'));

console.log('token_type:', toks.token_type, 'expires_in:', toks.expires_in);
console.log('scope:', toks.scope);

const atH = JSON.parse(Buffer.from(toks.access_token.split('.')[0], 'base64url').toString());
console.log('access_token header:', JSON.stringify(atH));

console.log('r.json keys:', Object.keys(toks));
const idt = toks.id_token;
console.log('id_token type:', typeof idt, 'len:', idt && idt.length, 'parts:', idt && idt.split('.').length);
const [h, p, s] = idt.split('.');
console.log('parts lens:', h.length, p.length, s.length);
console.log('p head:', p.slice(0, 40));
let decP;
try { decP = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { console.log('DECODE ERR:', e.message, 'raw p:', p.slice(0, 60)); process.exit(1); }
const decH = JSON.parse(Buffer.from(h, 'base64url').toString());
console.log('id_token header:', JSON.stringify(decH));
console.log('id_token header:', JSON.stringify(decH));
console.log('id_token claims:', JSON.stringify({
  iss: decP.iss, aud: decP.aud, sub: decP.sub, employee_id: decP.employee_id,
  roles: decP.roles, email: decP.email, name: decP.name, amr: decP.amr,
  iat: decP.iat, exp: decP.exp,
}));

const jwk = jwks.keys.find((k) => k.kid === decH.kid);
console.log('jwks key count:', jwks.keys.length, 'kid match:', jwk !== undefined, 'alg:', jwk && jwk.alg);

const pub = createPublicKey({ key: jwk, format: 'jwk' });
const sig = Buffer.from(s, 'base64url');
const v = createVerify('sha256');
v.update(h + '.' + p);
const ok = v.verify(pub, sig);
console.log('RS256 signature valid:', ok);
console.log('iss correct:', decP.iss === 'http://localhost:3004', 'aud correct:', decP.aud === 'lgu-hrms');
