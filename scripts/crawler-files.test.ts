import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gatewayFaq } from '../src/components/gatewayFaq';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('landing FAQ crawler copies', () => {
  it('matches the FAQPage JSON-LD in index.html', () => {
    const html = read('../index.html');
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(json).toBeDefined();
    const graph = JSON.parse(json!)['@graph'] as Array<Record<string, unknown>>;
    const faqPage = graph.find((node) => node['@type'] === 'FAQPage') as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(faqPage.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }))).toEqual(gatewayFaq.ko);
  });

  it('is included in llms.txt', () => {
    const llms = read('../public/llms.txt');
    for (const item of gatewayFaq.ko) {
      expect(llms).toContain(item.question);
      expect(llms).toContain(item.answer);
    }
  });

  it('lists every sitemap URL as allowed in robots.txt', () => {
    const robots = read('../public/robots.txt');
    const sitemap = read('../public/sitemap.xml');
    expect(robots).toContain('Sitemap: https://burillab.com/sitemap.xml');
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)/gm)].map((match) => match[1]);
    for (const [, url] of sitemap.matchAll(/<loc>https:\/\/burillab\.com(\/[^<]*)<\/loc>/g)) {
      expect(disallowed.some((prefix) => url.startsWith(prefix))).toBe(false);
    }
  });
});
