// Makes the key pair that locks the libSQL database on Railway. Run once: `npm run db:make-key`.
// It prints SQLD_AUTH_JWT_KEY (goes on the Railway database service) and LIBSQL_AUTH_TOKEN (goes on Render).
import { generateKeyPairSync, sign } from 'crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const body = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ a: 'rw', iat: Math.floor(Date.now() / 1000) })}`;
const token = `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
console.log(`SQLD_AUTH_JWT_KEY=${raw}\nLIBSQL_AUTH_TOKEN=${token}\n\nKeep both private. The token is the database password.`);
