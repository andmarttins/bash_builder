import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CapabilityGuard } from '../identity/capability.guard.js';
import { RequiredCapabilities } from '../identity/required-capabilities.decorator.js';
import { SessionContextGuard, type AuthenticatedRequest } from '../identity/session-context.guard.js';
import { OperationsService } from './operations.service.js';

@UseGuards(SessionContextGuard, CapabilityGuard)
@Controller('v1')
export class OperationsController {
  public constructor(private readonly operations: OperationsService) {}

  @Get('classifications') @RequiredCapabilities('operations.view')
  public classifications(@Req() request: AuthenticatedRequest, @Query('category') category?: string) { return this.operations.listClassifications(request.identity, category).then((items) => ({ items })); }
  @Post('classifications') @RequiredCapabilities('operations.manage')
  public createClassification(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createClassification(request.identity, input).then((item) => ({ item })); }

  @Get('events') @RequiredCapabilities('events.view')
  public events(@Req() request: AuthenticatedRequest) { return this.operations.listEvents(request.identity).then((events) => ({ events })); }
  @Post('events') @RequiredCapabilities('events.manage')
  public createEvent(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createEvent(request.identity, input).then((event) => ({ event })); }
  @Post('events/:eventId/actions') @RequiredCapabilities('events.manage')
  public addEventAction(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string, @Body() input: unknown) { return this.operations.addEventAction(request.identity, eventId, input).then((action) => ({ action })); }
  @Patch('events/:eventId/actions/:actionId/complete') @RequiredCapabilities('events.manage')
  public completeEventAction(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string, @Param('actionId') actionId: string) { return this.operations.completeEventAction(request.identity, eventId, actionId).then((action) => ({ action })); }
  @Post('events/:eventId/status') @RequiredCapabilities('events.manage')
  public transitionEvent(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string, @Body() input: unknown) { return this.operations.transitionEvent(request.identity, eventId, input).then((event) => ({ event })); }

  @Get('changes') @RequiredCapabilities('changes.view')
  public changes(@Req() request: AuthenticatedRequest, @Query() query: unknown) { return this.operations.listChanges(request.identity, query); }
  @Get('changes/:changeId') @RequiredCapabilities('changes.view')
  public change(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string) { return this.operations.getChange(request.identity, changeId); }
  @Post('changes') @RequiredCapabilities('changes.manage')
  public createChange(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createChange(request.identity, input).then((change) => ({ change })); }
  @Post('changes/:changeId/risks') @RequiredCapabilities('changes.manage')
  public addChangeRisk(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.addChangeRisk(request.identity, changeId, input).then((risk) => ({ risk })); }
  @Post('changes/:changeId/approvals') @RequiredCapabilities('changes.manage')
  public addChangeApproval(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.addChangeApproval(request.identity, changeId, input).then((approval) => ({ approval })); }
  @Post('changes/:changeId/approvals/:approvalId/decision') @RequiredCapabilities('changes.approve')
  public decideChangeApproval(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Param('approvalId') approvalId: string, @Body() input: unknown) { return this.operations.decideChangeApproval(request.identity, changeId, approvalId, input).then((approval) => ({ approval })); }
  @Post('changes/:changeId/evidence') @RequiredCapabilities('changes.manage')
  public addChangeEvidence(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.addChangeEvidence(request.identity, changeId, input).then((evidence) => ({ evidence })); }
  @Get('changes/:changeId/evidence/:evidenceId/download') @RequiredCapabilities('changes.view')
  public changeEvidenceDownload(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Param('evidenceId') evidenceId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.operations.openChangeEvidenceDownload(request.identity, changeId, evidenceId).then((download) => {
      reply.header('content-type', download.contentType ?? 'application/octet-stream');
      if (download.contentLength !== undefined) reply.header('content-length', download.contentLength);
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`);
      return download.body;
    });
  }
  @Post('changes/:changeId/steps/:step/complete') @RequiredCapabilities('changes.manage')
  public completeChangeWorkflowStep(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Param('step') step: string, @Body() input: unknown) { return this.operations.completeChangeWorkflowStep(request.identity, changeId, step, input).then((change) => ({ change })); }
  @Post('changes/:changeId/status') @RequiredCapabilities('changes.manage')
  public transitionChange(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.transitionChange(request.identity, changeId, input).then((change) => ({ change })); }

  @Get('bash/cards') @RequiredCapabilities('bash.view')
  public cards(@Req() request: AuthenticatedRequest) { return this.operations.listCards(request.identity).then((cards) => ({ cards })); }
  @Post('bash/cards') @RequiredCapabilities('bash.manage')
  public createCard(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createCard(request.identity, input).then((card) => ({ card })); }
  @Post('bash/cards/:cardId/comments') @RequiredCapabilities('bash.manage')
  public addCardComment(@Req() request: AuthenticatedRequest, @Param('cardId') cardId: string, @Body() input: unknown) { return this.operations.addCardComment(request.identity, cardId, input).then((comment) => ({ comment })); }
  @Post('bash/cards/:cardId/attachments') @RequiredCapabilities('bash.manage')
  public addCardAttachment(@Req() request: AuthenticatedRequest, @Param('cardId') cardId: string, @Body() input: unknown) { return this.operations.addCardAttachment(request.identity, cardId, input).then((attachment) => ({ attachment })); }
  @Get('bash/cards/:cardId/attachments/:attachmentId/download') @RequiredCapabilities('bash.view')
  public cardAttachmentDownload(@Req() request: AuthenticatedRequest, @Param('cardId') cardId: string, @Param('attachmentId') attachmentId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.operations.openCardAttachmentDownload(request.identity, cardId, attachmentId).then((download) => {
      reply.header('content-type', download.contentType ?? 'application/octet-stream');
      if (download.contentLength !== undefined) reply.header('content-length', download.contentLength);
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`);
      return download.body;
    });
  }
  @Patch('bash/cards/:cardId/move') @RequiredCapabilities('bash.manage')
  public moveCard(@Req() request: AuthenticatedRequest, @Param('cardId') cardId: string, @Body() input: unknown) { return this.operations.moveCard(request.identity, cardId, input).then((card) => ({ card })); }

  @Get('hht') @RequiredCapabilities('hht.view')
  public hht(@Req() request: AuthenticatedRequest) { return this.operations.listHht(request.identity); }
  @Post('hht/companies') @RequiredCapabilities('hht.manage')
  public createHhtCompany(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createHhtCompany(request.identity, input).then((company) => ({ company })); }
  @Put('hht/reports') @RequiredCapabilities('hht.manage')
  public upsertHhtReport(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.upsertHhtReport(request.identity, input).then((report) => ({ report })); }
  @Post('hht/reports/:reportId/status') @RequiredCapabilities('hht.manage')
  public setHhtReportStatus(@Req() request: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() input: unknown) { return this.operations.setHhtReportStatus(request.identity, reportId, input).then((report) => ({ report })); }
  @Put('hht/windows') @RequiredCapabilities('hht.manage')
  public upsertHhtWindow(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.upsertHhtWindow(request.identity, input).then((window) => ({ window })); }
  @Post('hht/windows/:year/:month/close') @RequiredCapabilities('hht.manage')
  public closeHhtWindow(@Req() request: AuthenticatedRequest, @Param('year') year: string, @Param('month') month: string, @Body() input: unknown) { return this.operations.closeHhtWindow(request.identity, year, month, input); }

  @Get('dashboards') @RequiredCapabilities('dashboards.view')
  public dashboards(@Req() request: AuthenticatedRequest) { return this.operations.listDashboards(request.identity).then((dashboards) => ({ dashboards })); }
  @Get('analytics/summary') @RequiredCapabilities('dashboards.view')
  public analyticsSummary(@Req() request: AuthenticatedRequest) { return this.operations.analyticsSummary(request.identity); }
  @Get('analytics/sources/:source') @RequiredCapabilities('dashboards.view')
  public analyticsSource(@Req() request: AuthenticatedRequest, @Param('source') source: string, @Query() query: unknown) { return this.operations.analyticsSource(request.identity, source, query); }
  @Post('dashboards') @RequiredCapabilities('dashboards.manage')
  public createDashboard(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createDashboard(request.identity, input).then((dashboard) => ({ dashboard })); }
  @Patch('dashboards/:dashboardId') @RequiredCapabilities('dashboards.manage')
  public updateDashboard(@Req() request: AuthenticatedRequest, @Param('dashboardId') dashboardId: string, @Body() input: unknown) { return this.operations.updateDashboard(request.identity, dashboardId, input).then((dashboard) => ({ dashboard })); }
  @Post('dashboards/:dashboardId/publish') @RequiredCapabilities('dashboards.manage')
  public publishDashboard(@Req() request: AuthenticatedRequest, @Param('dashboardId') dashboardId: string, @Body() input: unknown) { return this.operations.publishDashboard(request.identity, dashboardId, input); }

  @Get('tv') @RequiredCapabilities('tv.view')
  public tv(@Req() request: AuthenticatedRequest) { return this.operations.listTv(request.identity); }
  @Post('tv/displays') @RequiredCapabilities('tv.manage')
  public createTvDisplay(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createTvDisplay(request.identity, input).then((display) => ({ display })); }
  @Patch('tv/displays/:displayId') @RequiredCapabilities('tv.manage')
  public updateTvDisplay(@Req() request: AuthenticatedRequest, @Param('displayId') displayId: string, @Body() input: unknown) { return this.operations.updateTvDisplay(request.identity, displayId, input).then((display) => ({ display })); }
  @Post('tv/displays/:displayId/publish') @RequiredCapabilities('tv.manage')
  public publishTvDisplay(@Req() request: AuthenticatedRequest, @Param('displayId') displayId: string, @Body() input: unknown) { return this.operations.publishTvDisplay(request.identity, displayId, input); }
  @Post('tv/playlists') @RequiredCapabilities('tv.manage')
  public createTvPlaylist(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createTvPlaylist(request.identity, input).then((playlist) => ({ playlist })); }
  @Post('tv/playlists/:playlistId/publish') @RequiredCapabilities('tv.manage')
  public publishTvPlaylist(@Req() request: AuthenticatedRequest, @Param('playlistId') playlistId: string, @Body() input: unknown) { return this.operations.publishTvPlaylist(request.identity, playlistId, input); }

  @Get('integrations') @RequiredCapabilities('integrations.view')
  public integrations(@Req() request: AuthenticatedRequest) { return this.operations.listIntegrations(request.identity).then((integrations) => ({ integrations })); }
  @Post('integrations') @RequiredCapabilities('integrations.manage')
  public createIntegration(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createIntegration(request.identity, input).then((integration) => ({ integration })); }
  @Patch('integrations/:integrationId') @RequiredCapabilities('integrations.manage')
  public updateIntegration(@Req() request: AuthenticatedRequest, @Param('integrationId') integrationId: string, @Body() input: unknown) { return this.operations.updateIntegration(request.identity, integrationId, input).then((integration) => ({ integration })); }
  @Post('integrations/:integrationId/configuration/check') @RequiredCapabilities('integrations.manage')
  public checkIntegrationConfiguration(@Req() request: AuthenticatedRequest, @Param('integrationId') integrationId: string) { return this.operations.checkIntegrationConfiguration(request.identity, integrationId); }

  @Get('files/configuration') @RequiredCapabilities('operations.view')
  public fileUploadConfiguration() { return this.operations.fileUploadConfiguration(); }
  @Get('files') @RequiredCapabilities('operations.view')
  public files(@Req() request: AuthenticatedRequest) { return this.operations.listFiles(request.identity).then((files) => ({ files })); }
  @Post('files/intents') @RequiredCapabilities('operations.manage')
  public createFileIntent(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createFileIntent(request.identity, input); }
  @Post('files/:fileId/content') @RequiredCapabilities('operations.manage')
  public uploadFileContent(@Req() request: AuthenticatedRequest, @Param('fileId') fileId: string, @Body() content: Uint8Array) { return this.operations.uploadFileContent(request.identity, fileId, content).then((file) => ({ file })); }
  @Post('files/:fileId/cancel') @RequiredCapabilities('operations.manage')
  public cancelFileUpload(@Req() request: AuthenticatedRequest, @Param('fileId') fileId: string) { return this.operations.cancelFileUpload(request.identity, fileId).then((file) => ({ file })); }
  @Get('files/:fileId/download') @RequiredCapabilities('operations.view')
  public fileDownload(@Req() request: AuthenticatedRequest, @Param('fileId') fileId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.operations.openFileDownload(request.identity, fileId).then((download) => {
      reply.header('content-type', download.contentType ?? 'application/octet-stream');
      if (download.contentLength !== undefined) reply.header('content-length', download.contentLength);
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`);
      return download.body;
    });
  }

  @Get('operations/outbox/dead-letter') @RequiredCapabilities('operations.view')
  public deadLetters(@Req() request: AuthenticatedRequest) { return this.operations.listDeadLetters(request.identity).then((events) => ({ events })); }
  @Post('operations/outbox/dead-letter/:eventId/redrive') @RequiredCapabilities('operations.manage')
  public redriveDeadLetter(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string) { return this.operations.redriveDeadLetter(request.identity, eventId).then((event) => ({ event })); }
}
