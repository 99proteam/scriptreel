// Serve the local test site on http://127.0.0.1:4173 (or $PORT) so the examples can run against it.
import { serveSite } from '../tests/site/server.mjs';

const port = Number(process.env.PORT ?? 4173);
const { url } = await serveSite(port);
console.log(`Test site running at ${url}  (Ctrl+C to stop)`);
