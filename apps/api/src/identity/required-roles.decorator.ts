import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@builder/contracts';

export const requiredRolesKey = 'builder.required-roles';
export const RequiredRoles = (...roles: MembershipRole[]) => SetMetadata(requiredRolesKey, roles);
