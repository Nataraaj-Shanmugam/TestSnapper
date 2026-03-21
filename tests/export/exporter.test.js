import { describe, it, expect } from 'vitest';
import { Exporter } from '../../src/export.js';
import { sampleSession, sampleSteps } from '../helpers/fixtures.js';

const exporter = new Exporter();

// ──────────────────────────────────────────────
// toJSON
// ──────────────────────────────────────────────

describe('Exporter.toJSON', () => {
  it('returns an object with content, filename, and mimeType', () => {
    const result = exporter.toJSON(sampleSession, sampleSteps);
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('filename');
    expect(result).toHaveProperty('mimeType');
  });

  it('content is valid JSON', () => {
    const { content } = exporter.toJSON(sampleSession, sampleSteps);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('JSON content has session and steps keys', () => {
    const { content } = exporter.toJSON(sampleSession, sampleSteps);
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty('session');
    expect(parsed).toHaveProperty('steps');
    expect(Array.isArray(parsed.steps)).toBe(true);
  });

  it('steps array length matches input', () => {
    const { content } = exporter.toJSON(sampleSession, sampleSteps);
    const parsed = JSON.parse(content);
    expect(parsed.steps).toHaveLength(sampleSteps.length);
  });

  it('each step includes required fields', () => {
    const { content } = exporter.toJSON(sampleSession, sampleSteps);
    const parsed = JSON.parse(content);
    for (const step of parsed.steps) {
      expect(step).toHaveProperty('stepNumber');
      expect(step).toHaveProperty('action');
      expect(step).toHaveProperty('timestamp');
    }
  });

  it('mimeType is application/json', () => {
    const { mimeType } = exporter.toJSON(sampleSession, sampleSteps);
    expect(mimeType).toBe('application/json');
  });

  it('filename starts with testsnapper_ and ends with .json', () => {
    const { filename } = exporter.toJSON(sampleSession, sampleSteps);
    expect(filename).toMatch(/^testsnapper_.+\.json$/);
  });

  it('works with an empty steps array', () => {
    const { content } = exporter.toJSON(sampleSession, []);
    const parsed = JSON.parse(content);
    expect(parsed.steps).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// toCSV
// ──────────────────────────────────────────────

describe('Exporter.toCSV', () => {
  it('returns content, filename, mimeType', () => {
    const result = exporter.toCSV(sampleSession, sampleSteps);
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('filename');
    expect(result).toHaveProperty('mimeType');
  });

  it('mimeType is text/csv', () => {
    expect(exporter.toCSV(sampleSession, sampleSteps).mimeType).toBe('text/csv');
  });

  it('filename ends with .csv', () => {
    expect(exporter.toCSV(sampleSession, sampleSteps).filename).toMatch(/\.csv$/);
  });

  it('first row is the header row', () => {
    const { content } = exporter.toCSV(sampleSession, sampleSteps);
    const firstLine = content.split('\n')[0];
    expect(firstLine).toContain('Step');
    expect(firstLine).toContain('Action');
    expect(firstLine).toContain('Field Name');
  });

  it('number of rows equals steps + header', () => {
    const { content } = exporter.toCSV(sampleSession, sampleSteps);
    const lines = content.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(sampleSteps.length + 1);
  });

  it('values with commas are quoted', () => {
    const stepsWithComma = [{
      ...sampleSteps[0],
      value: 'hello, world',
      fieldName: 'Test Field',
      url: 'https://example.com'
    }];
    const { content } = exporter.toCSV(sampleSession, stepsWithComma);
    expect(content).toContain('"hello, world"');
  });

  it('handles empty steps array — header only', () => {
    const { content } = exporter.toCSV(sampleSession, []);
    const lines = content.split('\n').filter(l => l.trim() !== '');
    expect(lines).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// toMarkdown
// ──────────────────────────────────────────────

describe('Exporter.toMarkdown', () => {
  it('returns content, filename, mimeType', () => {
    const result = exporter.toMarkdown(sampleSession, sampleSteps);
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('filename');
    expect(result).toHaveProperty('mimeType');
  });

  it('mimeType is text/markdown', () => {
    expect(exporter.toMarkdown(sampleSession, sampleSteps).mimeType).toBe('text/markdown');
  });

  it('filename ends with .md', () => {
    expect(exporter.toMarkdown(sampleSession, sampleSteps).filename).toMatch(/\.md$/);
  });

  it('content starts with a markdown heading', () => {
    const { content } = exporter.toMarkdown(sampleSession, sampleSteps);
    expect(content.startsWith('# ')).toBe(true);
  });

  it('includes session name', () => {
    const { content } = exporter.toMarkdown(sampleSession, sampleSteps);
    expect(content).toContain(sampleSession.sessionName);
  });

  it('includes a step heading for each step', () => {
    const { content } = exporter.toMarkdown(sampleSession, sampleSteps);
    for (let i = 1; i <= sampleSteps.length; i++) {
      expect(content).toContain(`### Step ${i}:`);
    }
  });

  it('includes environment info', () => {
    const { content } = exporter.toMarkdown(sampleSession, sampleSteps);
    expect(content).toContain('## Environment');
    expect(content).toContain(sampleSession.env.url);
  });
});

// ──────────────────────────────────────────────
// export() router
// ──────────────────────────────────────────────

describe('Exporter.export', () => {
  it("routes 'json' to toJSON", () => {
    const result = exporter.export(sampleSession, sampleSteps, 'json');
    expect(result.mimeType).toBe('application/json');
  });

  it("routes 'csv' to toCSV", () => {
    const result = exporter.export(sampleSession, sampleSteps, 'csv');
    expect(result.mimeType).toBe('text/csv');
  });

  it("routes 'markdown' to toMarkdown", () => {
    const result = exporter.export(sampleSession, sampleSteps, 'markdown');
    expect(result.mimeType).toBe('text/markdown');
  });
});

// ──────────────────────────────────────────────
// _crc32
// ──────────────────────────────────────────────

describe('Exporter._crc32', () => {
  it('returns a number', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
    expect(typeof exporter._crc32(bytes)).toBe('number');
  });

  it('returns 0x352441C2 for "abc" (standard CRC32)', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    // CRC32 of "abc" is 0x352441C2
    expect(exporter._crc32(bytes) >>> 0).toBe(0x352441C2);
  });

  it('returns 0 for empty input', () => {
    // CRC32 of empty bytes is 0x00000000
    expect(exporter._crc32(new Uint8Array(0)) >>> 0).toBe(0x00000000);
  });

  it('is deterministic — same input gives same output', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(exporter._crc32(bytes)).toBe(exporter._crc32(bytes));
  });
});

// ──────────────────────────────────────────────
// _createZipBlob
// ──────────────────────────────────────────────

describe('Exporter._createZipBlob', () => {
  it('returns a Blob', async () => {
    const blob = await exporter._createZipBlob({ 'hello.txt': 'Hello World' });
    expect(blob).toBeInstanceOf(Blob);
  });

  it('starts with ZIP magic bytes PK (0x504B0304)', async () => {
    const blob = await exporter._createZipBlob({ 'test.txt': 'content' });
    // Use FileReader to read the blob (supported in jsdom)
    const buf = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const bytes = new Uint8Array(buf);
    // Local file header signature: 0x04034b50 in little-endian is bytes [50, 4b, 03, 04]
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4B); // K
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });

  it('creates a non-empty blob for multiple files', async () => {
    const blob = await exporter._createZipBlob({
      'file1.txt': 'content one',
      'file2.txt': 'content two'
    });
    expect(blob.size).toBeGreaterThan(0);
  });
});
