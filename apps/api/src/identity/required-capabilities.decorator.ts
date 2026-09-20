import { SetMetadata } from '@nestjs/common';
import type { Capability } from '@builder/contracts';

export const requiredCapabilitiesKey = 'builder.required-capabilities';
export const RequiredCapabilities = (...capabilities: Capability[]) => SetMetadata(requiredCapabilitiesKey, capabilities);
