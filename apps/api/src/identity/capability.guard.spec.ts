import { describe, expect, it } from 'vitest';
import { hasCapability } from '@builder/contracts';

describe('capability policy', () => {
  it('keeps tenant administration and write operations out of viewer access', () => {
    expect(hasCapability('OWNER', 'organization.manage')).toBe(true);
    expect(hasCapability('ADMIN', 'forms.manage')).toBe(true);
    expect(hasCapability('MEMBER', 'forms.manage')).toBe(false);
    expect(hasCapability('VIEWER', 'forms.submissions.manage')).toBe(false);
    expect(hasCapability('VIEWER', 'dashboards.view')).toBe(true);
  });
});
