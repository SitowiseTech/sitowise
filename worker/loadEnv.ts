/**
 * Side-effect module: put .env.local and .env into process.env.
 *
 * Next loads those files itself; a bare Node process does not. This has to run
 * before anything else the worker imports, because lib/chain.ts reads
 * NEXT_PUBLIC_FACTORY at module scope and would otherwise freeze the zero
 * address into the process. Import it on the first line of any worker entry
 * point. It is idempotent: dotenv never overwrites a variable that is already
 * set, so a real environment (systemd, Docker, a PaaS) still wins.
 */

import {config} from "dotenv";

config({path: [".env.local", ".env"], quiet: true});
