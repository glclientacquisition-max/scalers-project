#!/usr/bin/env node
// Raw vs production Soniox TTS listen harness for the shared normalization fixture.
//
// Usage:
//   node scripts/soniox-tts-listen-harness.js
//   node scripts/soniox-tts-listen-harness.js --mode raw
//   node scripts/soniox-tts-listen-harness.js --mode production
//   node scripts/soniox-tts-listen-harness.js --id 05-phone-spaced-local
//
// Requires SONIOX_API_KEY + SONIOX_VOICE for WAV output. Without them, still writes
// the scoring sheet and production-text manifest (no audio).

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { createSonioxTtsSession, isSonioxTtsConfigured, SAMPLE_RATE } =
  require('../src/speech/sonioxTts');

const FIXTURE_PATH = path.join(__dirname, '../tests/fixtures/tts-normalization.json');
const DEFAULT_OUTPUT = path.join(__dirname, '../output/tts-normalization');

function parseArgs(argv) {
  const opts = { mode: 'both', output: DEFAULT_OUTPUT, ids: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) {
      opts.mode = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      opts.output = path.resolve(argv[++i]);
    } else if (arg === '--id' && argv[i + 1]) {
      opts.ids = opts.ids || new Set();
      opts.ids.add(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/soniox-tts-listen-harness.js [options]

Options:
  --mode raw|production|both   Which audio passes to synthesize (default: both)
  --output <dir>               Output directory (default: output/tts-normalization)
  --id <fixture-id>            Repeatable filter for one case
`);
      process.exit(0);
    }
  }
  if (!['raw', 'production', 'both'].includes(opts.mode)) {
    throw new Error(`Invalid --mode ${opts.mode} (use raw, production, or both)`);
  }
  return opts;
}

function loadFixture() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  if (!Array.isArray(raw.cases) || !raw.cases.length) {
    throw new Error(`Fixture missing cases: ${FIXTURE_PATH}`);
  }
  return raw;
}

function writeWav(filePath, pcm, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  fs.writeFileSync(filePath, buffer);
}

async function synthesizeToPcm(text, speakOpts) {
  const chunks = [];
  const session = createSonioxTtsSession({
    callSid: 'tts-normalization-harness',
    onAudio: (pcm) => {
      if (pcm?.length) chunks.push(pcm);
    },
  });
  await session.ready;
  try {
    const result = await session.speak(text, speakOpts);
    if (result?.empty) return Buffer.alloc(0);
    return Buffer.concat(chunks);
  } finally {
    session.close();
  }
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildScoringRows(cases, rows) {
  const header = [
    'id',
    'group',
    'category',
    'string',
    'raw_text_to_soniox',
    'production_text_to_soniox',
    'pass_a_score',
    'pass_b_score',
    'notes',
  ];
  const lines = [header.join(',')];
  for (const c of cases) {
    const row = rows.get(c.id) || {};
    lines.push(
      [
        c.id,
        c.group,
        c.category,
        c.text,
        row.rawText ?? c.text,
        row.productionText ?? '',
        '',
        '',
        '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

function buildScoringMarkdown(fixture, cases, rows) {
  const lines = [
    '# TTS normalization listen scoring sheet',
    '',
    'Listen on a **phone speaker** (not laptop). Score each WAV:',
    '',
    '- **Pass** — natural; a Kenyan listener would not notice',
    '- **Soft fail** — understandable but awkward',
    '- **Hard fail** — wrong or confusing',
    '',
    '## Date priority (from live transcripts)',
    '',
    fixture.datePriorityNote || '_No date note in fixture._',
    '',
    '## Cases',
    '',
    '| id | group | category | input | raw → Soniox | production → Soniox | pass_a | pass_b | notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const c of cases) {
    const row = rows.get(c.id) || {};
    lines.push(
      `| ${c.id} | ${c.group} | ${c.category} | ${c.text.replace(/\|/g, '\\|')} | ${String(row.rawText ?? c.text).replace(/\|/g, '\\|')} | ${String(row.productionText ?? '').replace(/\|/g, '\\|')} | | | |`
    );
  }

  lines.push(
    '',
    '## WAV files',
    '',
    'When Soniox is configured, files are named `{id}_{mode}.wav` (e.g. `05-phone-spaced-local_raw.wav`).',
    '',
    '**Pass A** = raw Soniox (`alreadyPrepared: true`). **Pass B** = production (`prepareForTts` first).',
    '',
    'Only fix categories that **fail Pass B**. If Pass A fails but Pass B passes, leave code unchanged.',
    ''
  );
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const fixture = loadFixture();
  let cases = fixture.cases;
  if (opts.ids) {
    cases = cases.filter((c) => opts.ids.has(c.id));
    if (!cases.length) {
      throw new Error(`No fixture cases matched --id filter`);
    }
  }

  fs.mkdirSync(opts.output, { recursive: true });

  const modes =
    opts.mode === 'both' ? ['raw', 'production'] : [opts.mode];
  const sonioxReady = isSonioxTtsConfigured();
  const rows = new Map();

  for (const c of cases) {
    const prepared = prepareForTts(c.text, { callLanguage: c.callLanguage || 'en' });
    rows.set(c.id, {
      rawText: c.text,
      productionText: prepared.text,
      productionLanguage: prepared.language,
    });

    for (const mode of modes) {
      const spoken = mode === 'raw' ? c.text : prepared.text;
      const wavPath = path.join(opts.output, `${c.id}_${mode}.wav`);

      if (!sonioxReady) continue;

      if (!spoken.trim()) {
        console.warn(`[skip] ${c.id} ${mode}: empty spoken text`);
        continue;
      }

      process.stdout.write(`[synth] ${c.id} ${mode}… `);
      const pcm = await synthesizeToPcm(spoken, {
        alreadyPrepared: true,
        language: prepared.language,
        callLanguage: c.callLanguage || 'en',
      });
      if (!pcm.length) {
        console.log('empty');
        continue;
      }
      writeWav(wavPath, pcm);
      console.log(`${wavPath} (${pcm.length} bytes pcm)`);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    fixture: path.relative(process.cwd(), FIXTURE_PATH),
    sonioxConfigured: sonioxReady,
    modes,
    cases: cases.map((c) => {
      const row = rows.get(c.id);
      return {
        id: c.id,
        group: c.group,
        category: c.category,
        text: c.text,
        rawTextToSoniox: row.rawText,
        productionTextToSoniox: row.productionText,
        productionLanguage: row.productionLanguage,
        wav: modes.reduce((acc, mode) => {
          acc[mode] = sonioxReady
            ? path.relative(process.cwd(), path.join(opts.output, `${c.id}_${mode}.wav`))
            : null;
          return acc;
        }, {}),
      };
    }),
  };

  fs.writeFileSync(
    path.join(opts.output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(opts.output, 'scoring-sheet.csv'),
    buildScoringRows(cases, rows)
  );
  fs.writeFileSync(
    path.join(opts.output, 'scoring-sheet.md'),
    buildScoringMarkdown(fixture, cases, rows)
  );

  console.log(`\nWrote scoring sheet → ${path.join(opts.output, 'scoring-sheet.md')}`);
  if (!sonioxReady) {
    console.log(
      'Soniox not configured (SONIOX_API_KEY + SONIOX_VOICE). Skipped WAV synthesis; text manifest only.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
