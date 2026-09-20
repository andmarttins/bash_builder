import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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
  public changes(@Req() request: AuthenticatedRequest) { return this.operations.listChanges(request.identity).then((changes) => ({ changes })); }
  @Post('changes') @RequiredCapabilities('changes.manage')
  public createChange(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createChange(request.identity, input).then((change) => ({ change })); }
  @Post('changes/:changeId/risks') @RequiredCapabilities('changes.manage')
  public addChangeRisk(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.addChangeRisk(request.identity, changeId, input).then((risk) => ({ risk })); }
  @Post('changes/:changeId/status') @RequiredCapabilities('changes.manage')
  public transitionChange(@Req() request: AuthenticatedRequest, @Param('changeId') changeId: string, @Body() input: unknown) { return this.operations.transitionChange(request.identity, changeId, input).then((change) => ({ change })); }

  @Get('bash/cards') @RequiredCapabilities('bash.view')
  public cards(@Req() request: AuthenticatedRequest) { return this.operations.listCards(request.identity).then((cards) => ({ cards })); }
  @Post('bash/cards') @RequiredCapabilities('bash.manage')
  public createCard(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createCard(request.identity, input).then((card) => ({ card })); }
  @Post('bash/cards/:cardId/comments') @RequiredCapabilities('bash.manage')
  public addCardComment(@Req() request: AuthenticatedRequest, @Param('cardId') cardId: string, @Body() input: unknown) { return this.operations.addCardComment(request.identity, cardId, input).then((comment) => ({ comment })); }
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

  @Get('dashboards') @RequiredCapabilities('dashboards.view')
  public dashboards(@Req() request: AuthenticatedRequest) { return this.operations.listDashboards(request.identity).then((dashboards) => ({ dashboards })); }
  @Post('dashboards') @RequiredCapabilities('dashboards.manage')
  public createDashboard(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createDashboard(request.identity, input).then((dashboard) => ({ dashboard })); }
  @Patch('dashboards/:dashboardId') @RequiredCapabilities('dashboards.manage')
  public updateDashboard(@Req() request: AuthenticatedRequest, @Param('dashboardId') dashboardId: string, @Body() input: unknown) { return this.operations.updateDashboard(request.identity, dashboardId, input).then((dashboard) => ({ dashboard })); }
  @Post('dashboards/:dashboardId/publish') @RequiredCapabilities('dashboards.manage')
  public publishDashboard(@Req() request: AuthenticatedRequest, @Param('dashboardId') dashboardId: string, @Body() input: unknown) { return this.operations.publishDashboard(request.identity, dashboardId, input).then((dashboard) => ({ dashboard })); }

  @Get('tv') @RequiredCapabilities('tv.view')
  public tv(@Req() request: AuthenticatedRequest) { return this.operations.listTv(request.identity); }
  @Post('tv/displays') @RequiredCapabilities('tv.manage')
  public createTvDisplay(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createTvDisplay(request.identity, input).then((display) => ({ display })); }
  @Post('tv/playlists') @RequiredCapabilities('tv.manage')
  public createTvPlaylist(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createTvPlaylist(request.identity, input).then((playlist) => ({ playlist })); }

  @Get('integrations') @RequiredCapabilities('integrations.view')
  public integrations(@Req() request: AuthenticatedRequest) { return this.operations.listIntegrations(request.identity).then((integrations) => ({ integrations })); }
  @Post('integrations') @RequiredCapabilities('integrations.manage')
  public createIntegration(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createIntegration(request.identity, input).then((integration) => ({ integration })); }
  @Patch('integrations/:integrationId') @RequiredCapabilities('integrations.manage')
  public updateIntegration(@Req() request: AuthenticatedRequest, @Param('integrationId') integrationId: string, @Body() input: unknown) { return this.operations.updateIntegration(request.identity, integrationId, input).then((integration) => ({ integration })); }

  @Get('files') @RequiredCapabilities('operations.view')
  public files(@Req() request: AuthenticatedRequest) { return this.operations.listFiles(request.identity).then((files) => ({ files })); }
  @Post('files/intents') @RequiredCapabilities('operations.manage')
  public createFileIntent(@Req() request: AuthenticatedRequest, @Body() input: unknown) { return this.operations.createFileIntent(request.identity, input); }
}
