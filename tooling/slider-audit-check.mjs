import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from './test-electron.mjs';
import { modelUrl } from './effects-reference.mjs';
import { closeTestApp } from './close-test-app.mjs';
import { fileAction } from './file-action.mjs';

const { EFFECT_DEFINITIONS } = await import(modelUrl);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'test-results/slider-audit');
await mkdir(output, { recursive: true });
const cpu = process.argv.includes('--cpu');
const quick = process.argv.includes('--quick');
const layoutOnly = process.argv.includes('--layout-only');
const requestedTypes =
  process.argv
    .find((arg) => arg.startsWith('--effects='))
    ?.slice(10)
    .split(',') ?? [];
for (const type of requestedTypes) assert.ok(EFFECT_DEFINITIONS[type], `Unknown effect: ${type}`);
const label = `${cpu ? 'cpu' : 'gpu'}${quick ? '-quick' : ''}${layoutOnly ? '-layout' : ''}${requestedTypes.length ? '-focused' : ''}`;
const profile = await mkdtemp(resolve(output, `${label}-profile-`));
const env = { ...process.env, GLEECH_SMOKE_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const sharp = createRequire(resolve(root, 'apps/desktop/package.json'))('sharp');
const path = resolve(output, `${label}-portrait.png`);
await sharp({ create: { width: 64, height: 128, channels: 4, background: '#ac8040' } })
  .png()
  .toFile(path);
const app = await electron.launch({
  args: [
    resolve(root, 'apps/desktop'),
    '--smoke-test',
    ...(cpu ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
  ],
  env,
});
let page;
const failures = [],
  errors = [],
  checked = new Set();
let drags = 0,
  filters = 0;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }, path) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, path);
  const frame = () =>
    app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    });
  await page.getByRole('heading', { name: 'GLEECH.', exact: true }).waitFor();
  await frame();
  await fileAction(page, 'Open image Ctrl+Shift+O');
  await page
    .getByRole('status')
    .filter({ hasText: `Opened ${label}-portrait.png` })
    .first()
    .waitFor();
  async function drag(slider, id) {
    if (!(await slider.isVisible()) || !(await slider.isEnabled())) return;
    if (layoutOnly) {
      const result = await slider.evaluate(
        async (node, edge) => {
          const tick = () => new Promise((done) => setTimeout(done, 0));
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          const original = node.value;
          const min = Number(node.min || 0),
            max = Number(node.max || 100),
            step = Number(node.step || 1);
          node.scrollIntoView({ block: 'center', behavior: 'instant' });
          document.activeElement?.blur();
          const panel = node.closest('.inspector-panel');
          const range = node.getBoundingClientRect(),
            bounds = panel.getBoundingClientRect();
          panel.scrollTop +=
            range.y + range.height / 2 - (edge === 'bottom' ? bounds.bottom - 5 : bounds.top + 5);
          const before = node.getBoundingClientRect();
          node.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 }),
          );
          await tick();
          let failure = null;
          for (const fraction of [0.75, 0, 1, 0.25]) {
            set.call(node, min + (max - min) * fraction);
            node.dispatchEvent(new Event('input', { bubbles: true }));
            await tick();
            const bounds = node.getBoundingClientRect();
            const expected = min + (max - min) * fraction;
            if (
              Math.abs(bounds.y - before.y) > 1 ||
              Math.abs(bounds.height - before.height) > 1 ||
              Math.abs(Number(node.value) - expected) > step
            )
              failure = {
                expected,
                actual: Number(node.value),
                initialY: before.y,
                y: bounds.y,
                initialHeight: before.height,
                height: bounds.height,
              };
          }
          node.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }),
          );
          set.call(node, original);
          node.dispatchEvent(new Event('input', { bubbles: true }));
          await tick();
          return failure;
        },
        drags % 2 ? 'top' : 'bottom',
      );
      if (result) failures.push({ id, error: JSON.stringify(result) });
      drags++;
      return;
    }
    const original = await slider.inputValue();
    const limits = await slider.evaluate((n) => ({
      min: Number(n.min || 0),
      max: Number(n.max || 100),
      step: Number(n.step || 1),
    }));
    await slider.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    const at = (fraction) => box.x + 12 + (box.width - 24) * fraction;
    await page.mouse.move(at(0.5), y);
    await page.mouse.down();
    try {
      for (const fraction of [0.75, 0, 1, 0.25]) {
        await page.mouse.move(at(fraction), y);
        const bounds = await slider.boundingBox();
        const actual = Number(await slider.inputValue());
        const expected = limits.min + (limits.max - limits.min) * fraction;
        const tolerance = (limits.max - limits.min) * 0.08 + limits.step;
        if (
          Math.abs(bounds.y - box.y) > 1 ||
          Math.abs(bounds.height - box.height) > 1 ||
          Math.abs(actual - expected) > tolerance
        )
          throw new Error(
            JSON.stringify({
              expected,
              actual,
              initialY: box.y,
              y: bounds.y,
              initialHeight: box.height,
              height: bounds.height,
            }),
          );
      }
      drags++;
      if (drags % 25 === 0) console.log(JSON.stringify({ drags, failures: failures.length }));
    } catch (error) {
      failures.push({ id, error: String(error) });
    } finally {
      await page.mouse.up();
      if (await slider.count()) await slider.fill(original);
    }
  }
  async function audit(type) {
    const sliders = page.locator('.effect-detail input[type="range"]');
    const controls = await sliders.evaluateAll((nodes) =>
      nodes.map((n) => ({
        key:
          n.closest('[data-settings-key]')?.getAttribute('data-settings-key') ??
          n.getAttribute('aria-label'),
        label: n.getAttribute('aria-label'),
        disabled: n.disabled,
      })),
    );
    for (const control of controls) {
      const id = `${type}:${control.key}`;
      if (control.disabled || checked.has(id)) continue;
      checked.add(id);
      const keyed = page.locator(
        `.effect-detail [data-settings-key=${JSON.stringify(control.key)}] input[type="range"]`,
      );
      await drag(
        (await keyed.count())
          ? keyed
          : page.getByRole('slider', { name: control.label, exact: true }),
        id,
      );
    }
  }
  const entries = Object.entries(EFFECT_DEFINITIONS).filter(
    ([type]) =>
      (!requestedTypes.length || requestedTypes.includes(type)) &&
      (!quick ||
        [
          'detail',
          'indexed-palette',
          'crt',
          'compression-breakup',
          'depth-field',
          'glyph',
          'noise-grain',
          'spatial-crush',
        ].includes(type)),
  );
  for (const [type, definition] of entries) {
    await page.getByRole('button', { name: /Add effect/ }).evaluate((node) => node.click());
    await page
      .locator('.effect-picker')
      .getByRole('button', { name: definition.title, exact: true })
      .evaluate((node) => node.click());
    filters++;
    await audit(type);
    const visited = new Set();
    async function explore(depth = 0) {
      if (depth > 6) return;
      const choices = await page.locator('.effect-detail select').evaluateAll(
        (nodes, includeApplication) =>
          nodes
            .filter((n) => {
              const key = n.closest('[data-settings-key]')?.getAttribute('data-settings-key');
              return (
                key &&
                key !== 'blendMode' &&
                (includeApplication || !key.startsWith('application.'))
              );
            })
            .map((n) => ({
              label: n.getAttribute('aria-label'),
              original: n.value,
              values: [...n.options].map((o) => o.value),
            })),
        type === 'shader-caustics',
      );
      for (const choice of choices) {
        for (const value of choice.values.filter((v) => v !== choice.original)) {
          const visit = `${choice.label}:${value}`;
          if (visited.has(visit)) continue;
          const select = page.getByRole('combobox', { name: choice.label, exact: true });
          if (!(await select.count()) || !(await select.isEnabled())) continue;
          visited.add(visit);
          await select.evaluate((node, value) => {
            node.value = value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, value);
          await audit(type);
          await explore(depth + 1);
        }
        const select = page.getByRole('combobox', { name: choice.label, exact: true });
        if (await select.count())
          await select.evaluate((node, value) => {
            node.value = value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, choice.original);
      }
      const groups = await page
        .locator('.effect-detail .color-mode')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
      for (const group of groups) {
        const visit = `gradient:${group}`;
        if (visited.has(visit)) continue;
        const buttons = page.getByRole('group', { name: group, exact: true });
        const gradient = buttons.getByRole('button', { name: 'Gradient', exact: true });
        if (!(await gradient.isEnabled())) continue;
        visited.add(visit);
        await gradient.evaluate((node) => node.click());
        await audit(type);
        await page.locator('.gradient-placement input[type="range"]').evaluateAll((nodes) => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          for (const node of nodes)
            if (
              node
                .closest('[data-settings-key]')
                ?.getAttribute('data-settings-key')
                ?.endsWith('Angle')
            ) {
              set.call(node, 45);
              node.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await audit(type);
        await buttons
          .getByRole('button', { name: 'Solid', exact: true })
          .evaluate((node) => node.click());
      }
    }
    await explore();
    for (const checkbox of await page.locator('.effect-detail input[type="checkbox"]').all()) {
      if (!(await checkbox.isEnabled())) continue;
      await checkbox.evaluate((node) => node.click());
      await audit(type);
      await checkbox.evaluate((node) => node.click());
    }
    for (const key of ['sharpen', 'clarity', 'bloom', 'fieldBlend', 'drift', 'damageDensity']) {
      const gate = page.locator(`.effect-detail [data-settings-key="${key}"] input[type="range"]`);
      if (!(await gate.count()) || !(await gate.isEnabled())) continue;
      const original = await gate.inputValue();
      await gate.evaluate((node) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(node, Number(node.max) * 0.5);
        node.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await audit(type);
      await gate.evaluate((node, value) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }, original);
    }

    async function setParam(key, value) {
      const node = page
        .locator(`.effect-detail [data-settings-key="${key}"]`)
        .locator('select, input[type="range"]')
        .first();
      if (!(await node.count())) return;
      await node.evaluate((node, value) => {
        if (node instanceof HTMLSelectElement) {
          node.value = value;
          node.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
            node,
            value,
          );
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, String(value));
    }
    const configurations = {
      crt: { bloom: 1, bloomColorMix: 1 },
      glyph: {
        style: 'ascii',
        sizeFalloff: 'on',
        sizeDirection: 'radial',
        colorFalloff: 'on',
        colorDirection: 'radial',
        colorSource: 'chosen',
      },
      shapes: {
        layout: 'tiled',
        shape: 'polygon',
        rotationStyle: 'linear',
        polygonStyle: 'linear',
        progressionField: 'radial',
        operation: 'overlay',
      },
      dither: { algorithm: 'corrupted', coloring: 'rgb' },
      solid: { content: 'gradient', fillColorAngle: 45 },
      blur: { style: 'depth', fieldSource: 'perlin' },
      'recursive-space': { fieldEnabled: 'on', fieldSource: 'perlin' },
      'signal-tearing': { fieldEnabled: 'on', fieldSource: 'perlin' },
      'pigment-drag': { colorMix: 0.5 },
      scanlines: { glow: 1, signalError: 'jitter', errorStrength: 1, rotation: 45 },
    };
    for (const [key, value] of Object.entries(configurations[type] ?? {}))
      await setParam(key, value);
    await audit(type);
    visited.clear();
    await explore();
    if (type === 'channel-transform') {
      for (const channel of ['green', 'blue']) {
        await page
          .getByRole('combobox', { name: 'Editing channel', exact: true })
          .evaluate((node, value) => {
            node.value = value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, channel);
        await audit(type);
      }
    }
    if (type === 'blur') {
      await setParam('style', 'field');
      const addPoint = page.getByRole('button', { name: 'Add point', exact: true });
      while (await addPoint.isEnabled()) await addPoint.evaluate((node) => node.click());
      for (let index = 0; index < 8; index++) {
        await page
          .getByRole('combobox', { name: 'Selected field point', exact: true })
          .evaluate((node, value) => {
            node.value = String(value);
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }, index);
        await audit(type);
      }
    }
    console.log(JSON.stringify({ filter: type, drags, failures: failures.length }));
    await page
      .getByRole('button', { name: 'Delete selected effect', exact: true })
      .evaluate((node) => node.click());
  }
  await writeFile(
    resolve(output, `${label}-result.json`),
    JSON.stringify({ filters, drags, failures, errors, checked: [...checked] }, null, 2),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const nonSliderNumbers = new Set([
    'fieldSeed',
    'bitMask',
    'pointCount',
    'centerReal',
    'centerImaginary',
  ]);
  const missing = entries.flatMap(([type, definition]) =>
    Object.entries(definition.parameters)
      .filter(
        ([key, control]) =>
          control.kind === 'number' && !nonSliderNumbers.has(key) && !checked.has(`${type}:${key}`),
      )
      .map(([key]) => `${type}:${key}`),
  );
  if (!quick)
    assert.deepEqual(
      missing,
      [],
      'Every numeric filter slider must be audited in a compatible mode',
    );
} finally {
  await closeTestApp(app);
}
