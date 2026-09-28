import { describe, it, expect } from 'vitest';
import { safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it('returns fallback for null/undefined/empty', () => {
    expect(safeNextPath(null)).toBe('/portal');
    expect(safeNextPath(undefined)).toBe('/portal');
    expect(safeNextPath('')).toBe('/portal');
    expect(safeNextPath('   ')).toBe('/portal');
  });

  it('accepts root-relative paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/portal')).toBe('/portal');
    expect(safeNextPath('/a/b/c')).toBe('/a/b/c');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeNextPath('//evil.example')).toBe('/portal');
    expect(safeNextPath('///evil.example')).toBe('/portal');
  });

  it('rejects absolute URLs', () => {
    expect(safeNextPath('https://evil.example')).toBe('/portal');
    expect(safeNextPath('http://evil.example/path')).toBe('/portal');
    expect(safeNextPath('ftp://evil.example')).toBe('/portal');
  });

  it('rejects backslash tricks', () => {
    expect(safeNextPath('\\evil.example')).toBe('/portal');
    expect(safeNextPath('/\\evil.example')).toBe('/portal');
  });

  it('rejects CR/LF injection', () => {
    expect(safeNextPath('/path\r\nLocation: evil')).toBe('/portal');
    expect(safeNextPath('/path\nLocation: evil')).toBe('/portal');
  });

  it('rejects percent-encoded separators', () => {
    expect(safeNextPath('/%2f%2fevil.example')).toBe('/portal');
    expect(safeNextPath('/%5c%5cevil.example')).toBe('/portal');
    expect(safeNextPath('/%2Fevil')).toBe('/portal');
  });

  it('rejects scheme-looking prefixes', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/portal');
    expect(safeNextPath('data:text/html,<script>alert(1)</script>')).toBe('/portal');
  });

  it('uses custom fallback when provided', () => {
    expect(safeNextPath('//evil', '/login')).toBe('/login');
  });
});
