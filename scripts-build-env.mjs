// Vercel returns encrypted env vars as EMPTY strings from `vercel env pull`.
// Anything the build INLINES or PRERENDERS with therefore has to be supplied
// here, or the artifact ships with a hole in it. Three have bitten so far:
// the factory address (zero address in the bundle), the RPC url (prerender
// threw with no transport), and the payments address (its card silently
// vanished from the landing page).
import fs from 'node:fs';
const FILE = '.vercel/.env.production.local';
const VALUES = {
  NEXT_PUBLIC_FACTORY: '0x389699d7C3A754d6b82EbBBa0ebE5757ccfA1dD7',
  NEXT_PUBLIC_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
  PAYMENT_ADDRESS:     '0x6873E18dB91d14252ae56D085a60b419B82e073E',
};
let s = fs.readFileSync(FILE, 'utf8');
for (const [k, v] of Object.entries(VALUES)) {
  const line = `${k}="${v}"`;
  s = new RegExp(`^${k}=.*$`, 'm').test(s) ? s.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${s}\n${line}`;
  console.log('  filled', k);
}
fs.writeFileSync(FILE, s);
