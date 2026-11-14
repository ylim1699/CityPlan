import { describe, expect, it } from 'vitest';
import { recordDate } from '../agent/laserfiche';
import { kindOf } from '../src/hooks/useRecords';

describe('city archive record names', () => {
  it('reads the meeting date from the names the archive uses', () => {
    expect(recordDate('Council Minutes - October 21, 2026', '11/9/2026 9:37:04 PM')).toBe('2026-10-21');
    expect(recordDate('P&Z Minutes 10.22.26.pdf', '10/27/2026 3:49:15 PM')).toBe('2026-10-22');
    expect(recordDate('11-05-2026 P&Z Agenda', '')).toBe('2026-11-05');
  });
  it('falls back to the date the record was filed', () => {
    expect(recordDate('Agenda packet', '11/2/2026 10:09:50 PM')).toMatch(/^2026-11-0[23]$/);
    expect(recordDate('Agenda packet', '')).toBe('');
  });
  it('tells council, P&Z minutes and P&Z agendas apart by label', () => {
    expect(kindOf('City Council minutes, October 21 2026')).toBe('council');
    expect(kindOf('P&Z minutes, July 16 2026')).toBe('pz');
    expect(kindOf('P&Z agenda, November 5 2026')).toBe('pz-agenda');
  });
});
