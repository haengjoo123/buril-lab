import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { describe, expect, it } from 'vitest'

describe('Decisions native Cloudflare Request compatibility', () => {
  it('constructs the production request in workerd without following redirects', async () => {
    const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
      stdin: { resolveDir: process.cwd(), contents: `
        import {evaluateDecision} from './functions/api/ai/_decisions.ts';
        let calls = 0;
        globalThis.fetch = async (url, init) => {
          // Native workerd Request validates redirect support before the fake
          // upstream returns. No provider credentials or network are involved.
          const request = new Request(url, init);
          if (request.redirect !== 'manual') throw new Error('Redirects must not be followed');
          calls++;
          return Response.json({model:'gpt-6-luna',answers:[{type:'choice',name:'classification',choice:'ACID',confidence:0.4,
            probabilities:[{value:'ACID',probability:0.99},{value:'UNKNOWN',probability:0.01}]}]});
        };
        export default {async fetch() {
          const result = await evaluateDecision({OPENAI_API_KEY:' test-only\\r\\n'}, {
            feature:'classification',input:'test',instructions:'classify',choices:[{value:'ACID'},{value:'UNKNOWN'}],abstain:'UNKNOWN',safetyIdentifier:'test-only'
          });
          return Response.json({choice:result.choice,calls});
        }};
      ` } })
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-24' }))
    try {
      const response = await runtime.dispatchFetch('https://local.test')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ choice: 'ACID', calls: 1 })
    } finally { await runtime.dispose() }
  }, 15_000)
})
