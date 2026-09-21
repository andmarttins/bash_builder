import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
  public listSubmissions(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Query() query: unknown) { return this.forms.listSubmissions(request.identity, formId, query); }

  @Get(':formId/submissions/export')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.export')
  public async exportSubmissions(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Query() query: unknown, @Res({ passthrough: true }) response: FastifyReply) {
    const exported = await this.forms.exportSubmissions(request.identity, formId, query);
    response.header('content-type', exported.contentType).header('content-disposition', `attachment; filename="${exported.filename}"`).header('cache-control', 'no-store');
    return exported.csv;
  }

  @Patch(':formId/submissions/:submissionId')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.manage')
  public updateSubmissionStatus(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Param('submissionId') submissionId: string, @Body() input: unknown) {
    return this.forms.updateSubmissionStatus(request.identity, formId, submissionId, input).then((submission) => ({ submission }));
  }

  @Post(':formId/submissions/:submissionId/attachments')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.manage')
  public attachSubmissionFile(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Param('submissionId') submissionId: string, @Body() input: unknown) { return this.forms.attachSubmissionFile(request.identity, formId, submissionId, input).then((attachment) => ({ attachment })); }

  @Get(':formId/submissions/:submissionId/attachments/:attachmentId/download')
  @UseGuards(CapabilityGuard)
  @RequiredCapabilities('forms.submissions.view')
  public submissionAttachmentDownload(@Req() request: AuthenticatedRequest, @Param('formId') formId: string, @Param('submissionId') submissionId: string, @Param('attachmentId') attachmentId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.forms.openSubmissionAttachmentDownload(request.identity, formId, submissionId, attachmentId).then((download) => { reply.header('content-type', download.contentType ?? 'application/octet-stream'); if (download.contentLength !== undefined) reply.header('content-length', download.contentLength); reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`); return download.body; });
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
