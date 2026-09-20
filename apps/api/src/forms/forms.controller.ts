import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CapabilityGuard } from '../identity/capability.guard.js';
import { RequiredCapabilities } from '../identity/required-capabilities.decorator.js';
import { SessionContextGuard, type AuthenticatedRequest } from '../identity/session-context.guard.js';
import { FormsService } from './forms.service.js';

@Controller('v1/forms')
@UseGuards(SessionContextGuard)
export class FormsController {
  public constructor(private readonly forms: FormsService) {}

  @Get()
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.view')
  public list(@Req() request: AuthenticatedRequest) { return this.forms.list(request.identity).then((forms) => ({ forms })); }

  @Get(':formId')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.view')
  public get(@Req() request: AuthenticatedRequest, @Param('formId') formId: string) { return this.forms.get(request.identity, formId).then((form) => ({ form })); }

  @Post()
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public create(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.forms.create(request.identity, input).then((form) => ({ form })); }

  @Patch(':formId')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public update(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Body() input: unknown) { return this.forms.update(request.identity, formId, input).then((form) => ({ form })); }

  @Put(':formId/fields')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public replaceFields(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Body() input: unknown) { return this.forms.replaceFields(request.identity, formId, input).then((form) => ({ form })); }

  @Post(':formId/status')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public setStatus(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Body() input: unknown) { return this.forms.setStatus(request.identity, formId, input).then((form) => ({ form })); }

  @Post(':formId/publication')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public publish(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Body() input: unknown) { return this.forms.publish(request.identity, formId, input).then((form) => ({ form })); }

  @Post(':formId/publication/revoke')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.manage')
  public revokePublication(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Body() input: unknown) { return this.forms.revokePublication(request.identity, formId, input).then((form) => ({ form })); }

  @Get(':formId/submissions')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.view')
  public listSubmissions(@Req() request: AuthenticatedRequest, @Param('formId') formId: string) { return this.forms.listSubmissions(request.identity, formId).then((submissions) => ({ submissions })); }

  @Patch(':formId/submissions/:submissionId')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.manage')
  public updateSubmissionStatus(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Param('submissionId') submissionId: string, @Body() input: unknown) {
    return this.forms.updateSubmissionStatus(request.identity, formId, submissionId, input).then((submission) => ({ submission }));
  }
}

@Controller('v1/public/forms')
export class PublicFormsController {
  public constructor(private readonly forms: FormsService) {}

  @Get(':publicId')
  public get(@Param('publicId') publicId: string) { return this.forms.publicDefinition(publicId).then((form) => ({ form })); }

  @Post(':publicId/submissions')
  public submit(@Param('publicId') publicId: string, @Body() answers: unknown) { return this.forms.submitPublic(publicId, answers).then((submission) => ({ submission })); }
}
