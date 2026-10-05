import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScript, parseScript, parseScriptSource, ScriptError } from '../../src/script/parse.js';

const YAML_EXAMPLE = `
url: https://example.com
viewport: { width: 1440, height: 900 }
steps:
  - caption: "Sign in to your dashboard"
  - click: "text=Log in"
  - type: { selector: "#email", text: "demo@example.com" }
  - type: { selector: "#password", text: "secret", hidden: true }
  - click: "button[type=submit]"
  - wait: { selector: ".dashboard" }
  - zoom: ".revenue-chart"
  - scroll: { to: "#pricing" }
  - pause: 1500
`;

describe('parseScriptSource', () => {
  it('parses the documented example', () => {
    const script = parseScriptSource(YAML_EXAMPLE, { env: {} });
    expect(script.url).toBe('https://example.com');
    expect(script.viewport).toEqual({ width: 1440, height: 900 });
    expect(script.steps.map((s) => s.kind)).toEqual([
      'caption', 'click', 'type', 'type', 'click', 'wait', 'zoom', 'scroll', 'pause',
    ]);
    expect(script.steps[1]).toMatchObject({ kind: 'click', selector: 'text=Log in', button: 'left', double: false });
    expect(script.steps[3]).toMatchObject({ kind: 'type', hidden: true, clear: true, text: 'secret' });
    expect(script.steps[5]).toMatchObject({ kind: 'wait', selector: '.dashboard' });
    expect(script.steps[7]).toMatchObject({ kind: 'scroll', to: '#pricing' });
    expect(script.steps[8]).toMatchObject({ kind: 'pause', ms: 1500 });
    expect(script.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('never puts hidden text in step labels', () => {
    const script = parseScriptSource(YAML_EXAMPLE, { env: {} });
    expect(script.steps[3]?.label).not.toContain('secret');
    expect(script.steps[2]?.label).toContain('demo@example.com');
  });

  it('uses a default viewport', () => {
    const script = parseScript({ url: 'https://a.dev', steps: [{ pause: 10 }] });
    expect(script.viewport).toEqual({ width: 1440, height: 900 });
  });

  it('reports YAML syntax errors as ScriptError', () => {
    expect(() => parseScriptSource('url: [unclosed', { env: {} })).toThrow(ScriptError);
  });
});

describe('step shorthands and options', () => {
  const parse = (step: unknown) => parseScript({ url: 'https://a.dev', steps: [step] }, { env: {} }).steps[0];

  it('accepts shorthand and long forms', () => {
    expect(parse({ hover: '.menu' })).toMatchObject({ kind: 'hover', selector: '.menu' });
    expect(parse({ wait: 500 })).toMatchObject({ kind: 'wait', ms: 500 });
    expect(parse({ wait: '.ready' })).toMatchObject({ kind: 'wait', selector: '.ready' });
    expect(parse({ wait: { url: '**/done' } })).toMatchObject({ kind: 'wait', url: '**/done' });
    expect(parse({ scroll: 400 })).toMatchObject({ kind: 'scroll', by: 400 });
    expect(parse({ scroll: '#footer' })).toMatchObject({ kind: 'scroll', to: '#footer' });
    expect(parse({ scroll: { y: 0 } })).toMatchObject({ kind: 'scroll', y: 0 });
    expect(parse({ zoom: { selector: '.a', scale: 2, duration: 900 } })).toMatchObject({ kind: 'zoom', scale: 2, duration: 900 });
    expect(parse({ click: { selector: '.row', double: true } })).toMatchObject({ kind: 'click', double: true });
    expect(parse({ select: { selector: '#size', value: 'L' } })).toMatchObject({ kind: 'select', value: ['L'] });
    expect(parse({ press: 'Enter' })).toMatchObject({ kind: 'press', key: 'Enter' });
    expect(parse({ goto: '/pricing' })).toMatchObject({ kind: 'goto', url: '/pricing' });
    expect(parse({ caption: null })).toMatchObject({ kind: 'caption', text: null });
    expect(parse({ caption: { text: 'Hi', duration: 2000 } })).toMatchObject({ kind: 'caption', text: 'Hi', duration: 2000 });
    expect(parse({ type: { text: 'hello', clear: false, submit: true } })).toMatchObject({ kind: 'type', clear: false, submit: true });
  });

  it('attaches voice-over text to any step', () => {
    expect(parse({ click: '#go', voiceover: '  Now we click go.  ' })).toMatchObject({ voiceover: 'Now we click go.' });
  });

  it('collects every problem with a helpful message', () => {
    try {
      parseScript(
        {
          url: 3,
          zoom: 'huge',
          extra: true,
          steps: [{ click: '#a', type: { text: 'x' } }, { jump: 1 }, { type: { selector: '#a' } }, 'click'],
        },
        { env: {} },
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScriptError);
      const issues = (err as ScriptError).issues.join('\n');
      expect(issues).toContain('unknown top-level key "extra"');
      expect(issues).toContain('`url` is required');
      expect(issues).toContain('`zoom` must be one of');
      expect(issues).toContain('steps[0]: has more than one action');
      expect(issues).toContain('steps[1]: unknown key "jump"');
      expect(issues).toContain('steps[2]: `type` must be { selector, text }');
      expect(issues).toContain('steps[3]: each step must be an object');
    }
  });

  it('rejects empty step lists', () => {
    expect(() => parseScript({ url: 'https://a.dev', steps: [] })).toThrow(/at least one step/);
  });
});

describe('environment placeholders', () => {
  it('fills ${VAR} placeholders and records secrets', () => {
    const script = parseScript(
      { url: '${BASE}/login', steps: [{ type: { selector: '#p', text: '${PASSWORD}', hidden: true } }] },
      { env: { BASE: 'https://app.dev', PASSWORD: 'hunter2' } },
    );
    expect(script.url).toBe('https://app.dev/login');
    expect(script.steps[0]).toMatchObject({ text: 'hunter2' });
    expect(script.secrets).toContain('hunter2');
  });

  it('supports defaults and escapes', () => {
    const script = parseScript(
      { url: '${BASE:-http://localhost:3000}', steps: [{ caption: 'Cost: $${PRICE}' }] },
      { env: {} },
    );
    expect(script.url).toBe('http://localhost:3000');
    expect(script.steps[0]).toMatchObject({ text: 'Cost: ${PRICE}' });
    expect(script.secrets).toEqual([]);
  });

  it('fails clearly when a variable is missing', () => {
    expect(() => parseScript({ url: 'https://a.dev', steps: [{ type: { text: '${NOPE}' } }] }, { env: {} })).toThrow(
      /\$\{NOPE\} is not set/,
    );
  });
});

describe('loadScript', () => {
  it('loads YAML, JSON and TypeScript files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scriptreel-test-'));
    await writeFile(join(dir, 'demo.yml'), YAML_EXAMPLE);
    await writeFile(join(dir, 'demo.json'), JSON.stringify({ url: 'https://json.dev', steps: [{ pause: 1 }] }));
    await writeFile(
      join(dir, 'demo.ts'),
      `const steps: Array<Record<string, unknown>> = [{ click: '#go' }, { pause: 100 }];
       export default { url: 'https://ts.dev', viewport: { width: 800, height: 600 }, steps };`,
    );
    expect((await loadScript(join(dir, 'demo.yml'), { env: {} })).steps).toHaveLength(9);
    expect((await loadScript(join(dir, 'demo.json'), { env: {} })).url).toBe('https://json.dev');
    const ts = await loadScript(join(dir, 'demo.ts'), { env: {} });
    expect(ts.url).toBe('https://ts.dev');
    expect(ts.viewport).toEqual({ width: 800, height: 600 });
    expect(ts.steps.map((s) => s.kind)).toEqual(['click', 'pause']);
  });

  it('throws a ScriptError for missing files', async () => {
    await expect(loadScript('does-not-exist.yml')).rejects.toThrow(ScriptError);
  });
});
