import {
  Bell,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { resolveSubmissionCursorPage } from "./submission-pagination.js";
import { DashboardShell } from "./dashboard-shell.js";
import {
  DashboardsModulePage,
  PublicDashboardPage,
} from "./dashboard-publication.js";
import { PublicTvDisplayPage, PublicTvPlaylistPage } from "./tv-publication.js";

type Identity = {
  user: { id: string; email: string };
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: string };
  access: { isPlatformAdmin: boolean; requiresPasswordChange: boolean };
};
type AuthMode =
  | "loading"
  | "bootstrap"
  | "login"
  | "change-password"
  | "invite"
  | "signed-in";
type WorkspaceView =
  | "home"
  | "forms"
  | "notifications"
  | "events"
  | "changes"
  | "bash"
  | "hht"
  | "dashboards"
  | "tv"
  | "integrations"
  | "classifications"
  | "files"
  | "organization"
  | "profile";
type Organization = {
  id: string;
  name: string;
  slug: string;
  membership: { id: string; role: string };
};
type Member = {
  id: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};
type FormFieldSummary = {
  key: string;
  label: string;
  type:
    | "SHORT_TEXT"
    | "LONG_TEXT"
    | "NUMBER"
    | "DATE"
    | "SELECT"
    | "MULTI_SELECT"
    | "CHECKBOX";
  required: boolean;
  options: string[];
  position: number;
};
type FormSummary = {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: number;
  fields: FormFieldSummary[];
};
type FormSubmission = {
  id: string;
  status: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "REJECTED";
  submittedAt: string;
  formVersion: number;
  formSnapshot: { fields?: Array<{ key: string; label: string }> };
  answers: Record<string, unknown>;
};
type SubmissionPagination = {
  pageSize: number;
  total: number;
  nextCursor: string | null;
};
type SubmissionPager = SubmissionPagination & { page: number };
type PublicForm = {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  fields: Array<{
    key: string;
    label: string;
    type:
      | "SHORT_TEXT"
      | "LONG_TEXT"
      | "NUMBER"
      | "DATE"
      | "SELECT"
      | "MULTI_SELECT"
      | "CHECKBOX";
    required: boolean;
    options: string[];
    position: number;
  }>;
};
type UserNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  target: WorkspaceView | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: string | string[];
  };
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message)
        ? body.message[0]
        : (body.message ?? "Não foi possível concluir a solicitação."),
    );
  return body as T;
}

export function App(): React.JSX.Element {
  const publicFormId = /^\/f\/([0-9a-f-]{36})$/i.exec(
    window.location.pathname,
  )?.[1];
  const publicDashboardToken = /^\/p\/([A-Za-z0-9_-]{43})$/.exec(
    window.location.pathname,
  )?.[1];
  const publicTvDisplayToken = /^\/tv\/([A-Za-z0-9_-]{43})$/.exec(
    window.location.pathname,
  )?.[1];
  const publicTvPlaylistToken = /^\/tv\/playlist\/([A-Za-z0-9_-]{43})$/.exec(
    window.location.pathname,
  )?.[1];
  const [mode, setMode] = useState<AuthMode>("loading");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationToken] = useState(() =>
    new URLSearchParams(window.location.search).get("invite"),
  );
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [selectedForm, setSelectedForm] = useState<FormSummary | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [submissionPagination, setSubmissionPagination] =
    useState<SubmissionPager>({
      page: 1,
      pageSize: 25,
      total: 0,
      nextCursor: null,
    });
  const [submissionCursorHistory, setSubmissionCursorHistory] = useState<
    Array<string | null>
  >([]);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<
    FormSubmission["status"] | ""
  >("");
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    void (async () => {
      if (
        publicFormId ||
        publicDashboardToken ||
        publicTvDisplayToken ||
        publicTvPlaylistToken
      )
        return;
      if (invitationToken) {
        setMode("invite");
        return;
      }
      try {
        const [session, bootstrap] = await Promise.all([
          api<{ identity: Identity | null }>("/v1/auth/session"),
          api<{ bootstrapRequired: boolean }>("/v1/auth/bootstrap-status"),
        ]);
        if (session.identity) {
          setIdentity(session.identity);
          setWorkspaceView("home");
          setMode(
            session.identity.access.requiresPasswordChange
              ? "change-password"
              : "signed-in",
          );
        } else setMode(bootstrap.bootstrapRequired ? "bootstrap" : "login");
      } catch {
        setError(
          "Não foi possível conectar à plataforma. Atualize a página em alguns instantes.",
        );
        setMode("login");
      }
    })();
  }, [
    invitationToken,
    publicDashboardToken,
    publicFormId,
    publicTvDisplayToken,
    publicTvPlaylistToken,
  ]);

  useEffect(() => {
    void (async () => {
      if (mode !== "signed-in" || !identity) return;
      try {
        const organizationResponse = await api<{
          organizations: Organization[];
        }>("/v1/organizations");
        setOrganizations(organizationResponse.organizations);
        if (
          identity.membership.role === "OWNER" ||
          identity.membership.role === "ADMIN"
        ) {
          const [memberResponse, invitationResponse] = await Promise.all([
            api<{ members: Member[] }>("/v1/organizations/current/members"),
            api<{ invitations: Invitation[] }>(
              "/v1/organizations/current/invitations",
            ),
          ]);
          setMembers(memberResponse.members);
          setInvitations(invitationResponse.invitations);
        } else {
          setMembers([]);
          setInvitations([]);
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar a administração da organização.",
        );
      }
    })();
  }, [identity, mode]);

  useEffect(() => {
    void (async () => {
      if (mode !== "signed-in" || !identity || workspaceView !== "forms")
        return;
      try {
        setForms((await api<{ forms: FormSummary[] }>("/v1/forms")).forms);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Não foi possível carregar os formulários.",
        );
      }
    })();
  }, [identity, mode, workspaceView]);

  const loadNotifications = useCallback(async () => {
    const response = await api<{ items: UserNotification[]; unread: number }>(
      "/v1/notifications",
    );
    setNotifications(response.items);
    setUnreadNotifications(response.unread);
  }, []);

  useEffect(() => {
    if (mode !== "signed-in" || !identity) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }
    void loadNotifications().catch(() => undefined);
    const timer = window.setInterval(() => {
      void loadNotifications().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [identity, loadNotifications, mode]);

  async function openNotification(
    notification: UserNotification,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      if (!notification.readAt)
        await api(`/v1/notifications/${notification.id}/read`, {
          method: "PATCH",
          body: "{}",
        });
      await loadNotifications();
      if (notification.target) setWorkspaceView(notification.target);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a notificação.",
      );
    } finally {
      setPending(false);
    }
  }

  async function markAllNotificationsRead(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api("/v1/notifications/read-all", { method: "POST", body: "{}" });
      await loadNotifications();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar as notificações.",
      );
    } finally {
      setPending(false);
    }
  }

  async function submitBootstrap(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await submit(
      "/v1/auth/bootstrap",
      {
        email: values.get("email"),
        password: values.get("password"),
        organizationName: values.get("organizationName"),
        organizationSlug: values.get("organizationSlug"),
      },
      { "x-bootstrap-token": String(values.get("bootstrapToken") ?? "") },
    );
  }
  async function submitLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await submit("/v1/auth/login", {
      email: values.get("email"),
      password: values.get("password"),
    });
  }
  async function submitPasswordChange(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await submit("/v1/auth/change-password", {
      currentPassword: values.get("currentPassword"),
      newPassword: values.get("newPassword"),
    });
  }
  async function submit(
    path: string,
    payload: Record<string, FormDataEntryValue | null>,
    headers?: HeadersInit,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await api<{ identity: Identity }>(path, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      setIdentity(result.identity);
      setWorkspaceView("home");
      setMode(
        result.identity.access.requiresPasswordChange
          ? "change-password"
          : "signed-in",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível concluir a solicitação.",
      );
    } finally {
      setPending(false);
    }
  }
  async function logout(): Promise<void> {
    setPending(true);
    try {
      await api("/v1/auth/logout", { method: "POST" });
      setIdentity(null);
      setMode("login");
    } finally {
      setPending(false);
    }
  }
  async function changeOwnPassword(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setProfileNotice(null);
    try {
      const result = await api<{ identity: Identity }>(
        "/v1/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword: values.get("currentPassword"),
            newPassword: values.get("newPassword"),
          }),
        },
      );
      setIdentity(result.identity);
      event.currentTarget.reset();
      setProfileNotice(
        "Senha atualizada. As demais sessões desta conta foram encerradas.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a senha.",
      );
    } finally {
      setPending(false);
    }
  }
  async function switchOrganization(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await api<{ identity: Identity }>(
        "/v1/organizations/switch",
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: values.get("organizationId"),
          }),
        },
      );
      setIdentity(result.identity);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível trocar a organização.",
      );
    } finally {
      setPending(false);
    }
  }
  async function createOrganization(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          slug: values.get("slug"),
        }),
      });
      event.currentTarget.reset();
      const result = await api<{ organizations: Organization[] }>(
        "/v1/organizations",
      );
      setOrganizations(result.organizations);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar a organização.",
      );
    } finally {
      setPending(false);
    }
  }
  async function updateMember(
    event: FormEvent<HTMLFormElement>,
    memberId: string,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/organizations/current/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({
          role: values.get("role"),
          status: values.get("status"),
        }),
      });
      const result = await api<{ members: Member[] }>(
        "/v1/organizations/current/members",
      );
      setMembers(result.members);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar o membro.",
      );
    } finally {
      setPending(false);
    }
  }
  async function createInvitation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setInvitationUrl(null);
    try {
      const result = await api<{ invitationToken: string }>(
        "/v1/organizations/current/invitations",
        {
          method: "POST",
          body: JSON.stringify({
            email: values.get("email"),
            role: values.get("role"),
          }),
        },
      );
      event.currentTarget.reset();
      setInvitationUrl(
        `${window.location.origin}/?invite=${encodeURIComponent(result.invitationToken)}`,
      );
      const invitationsResponse = await api<{ invitations: Invitation[] }>(
        "/v1/organizations/current/invitations",
      );
      setInvitations(invitationsResponse.invitations);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar o convite.",
      );
    } finally {
      setPending(false);
    }
  }
  async function acceptInvitation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await api<{ identity: Identity }>(
        "/v1/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify({
            token: invitationToken,
            password: values.get("password"),
          }),
        },
      );
      window.history.replaceState({}, "", "/");
      setIdentity(result.identity);
      setWorkspaceView("home");
      setMode("signed-in");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível aceitar o convite.",
      );
    } finally {
      setPending(false);
    }
  }
  async function acceptInvitationAsExistingUser(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const session = await api<{ identity: Identity }>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: values.get("email"),
          password: values.get("password"),
        }),
      });
      await api("/v1/organizations/current/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: invitationToken }),
      });
      window.history.replaceState({}, "", "/");
      setIdentity(session.identity);
      setWorkspaceView("home");
      setMode("signed-in");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível associar este convite à conta existente.",
      );
    } finally {
      setPending(false);
    }
  }
  async function revokeInvitation(invitationId: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/organizations/current/invitations/${invitationId}`, {
        method: "DELETE",
      });
      setInvitations((current) =>
        current.filter((invitation) => invitation.id !== invitationId),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível revogar o convite.",
      );
    } finally {
      setPending(false);
    }
  }
  async function createForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/forms", {
        method: "POST",
        body: JSON.stringify({
          title: values.get("title"),
          description: values.get("description") || undefined,
          fields: [
            {
              key: "descricao",
              label: "Descrição",
              type: "LONG_TEXT",
              required: true,
              options: [],
            },
          ],
        }),
      });
      event.currentTarget.reset();
      setForms((await api<{ forms: FormSummary[] }>("/v1/forms")).forms);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar o formulário.",
      );
    } finally {
      setPending(false);
    }
  }
  async function openForm(formId: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const form = (await api<{ form: FormSummary }>(`/v1/forms/${formId}`))
        .form;
      setSelectedForm(form);
      if (
        identity &&
        (identity.membership.role === "OWNER" ||
          identity.membership.role === "ADMIN" ||
          identity.membership.role === "MEMBER")
      )
        await loadSubmissions(formId, 1, submissionStatusFilter);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível abrir o formulário.",
      );
    } finally {
      setPending(false);
    }
  }
  async function loadSubmissions(
    formId: string,
    requestedPage = 1,
    status = submissionStatusFilter,
  ): Promise<void> {
    const { page, cursor } = resolveSubmissionCursorPage({
      requestedPage,
      currentPage: submissionPagination.page,
      nextCursor: submissionPagination.nextCursor,
      pageCursors: submissionCursorHistory,
    });
    const query = new URLSearchParams({ pageSize: "25" });
    if (status) query.set("status", status);
    if (cursor) query.set("cursor", cursor);
    const response = await api<{
      submissions: FormSubmission[];
      pagination: SubmissionPagination;
    }>(`/v1/forms/${formId}/submissions?${query.toString()}`);
    setSubmissions(response.submissions);
    setSubmissionPagination({ ...response.pagination, page });
    setSubmissionStatusFilter(status);
    setSubmissionCursorHistory((history) =>
      page <= 1 ? [null] : [...history.slice(0, page - 1), cursor],
    );
  }
  async function updateSubmissionStatus(
    submission: FormSubmission,
    status: FormSubmission["status"],
  ): Promise<void> {
    if (!selectedForm || status === submission.status) return;
    setPending(true);
    setError(null);
    try {
      await api(`/v1/forms/${selectedForm.id}/submissions/${submission.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedStatus: submission.status, status }),
      });
      await loadSubmissions(selectedForm.id, submissionPagination.page);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a tratativa.",
      );
    } finally {
      setPending(false);
    }
  }
  async function refreshForms(selectedId?: string): Promise<void> {
    const next = (await api<{ forms: FormSummary[] }>("/v1/forms")).forms;
    setForms(next);
    const id = selectedId ?? selectedForm?.id;
    if (id) setSelectedForm(next.find((form) => form.id === id) ?? null);
  }
  async function addFormField(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!selectedForm) return;
    const values = new FormData(event.currentTarget);
    const key = slugValue(String(values.get("label") ?? ""));
    const type = String(values.get("type")) as FormFieldSummary["type"];
    const options = ["SELECT", "MULTI_SELECT"].includes(type)
      ? String(values.get("options") ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    if (["SELECT", "MULTI_SELECT"].includes(type) && options.length === 0) {
      setError("Informe ao menos uma opção, separada por vírgula.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await replaceFormFields([
        ...selectedForm.fields,
        {
          key,
          label: String(values.get("label")),
          type,
          required: values.get("required") === "on",
          options,
          position: selectedForm.fields.length,
        },
      ]);
      event.currentTarget.reset();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível adicionar o campo.",
      );
    } finally {
      setPending(false);
    }
  }
  async function replaceFormFields(fields: FormFieldSummary[]): Promise<void> {
    if (!selectedForm) return;
    const normalized = fields.map((field, position) => ({
      ...field,
      position,
    }));
    const form = (
      await api<{ form: FormSummary }>(`/v1/forms/${selectedForm.id}/fields`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: selectedForm.version,
          fields: normalized,
        }),
      })
    ).form;
    setSelectedForm(form);
    await refreshForms(form.id);
  }
  async function removeFormField(key: string): Promise<void> {
    if (!selectedForm) return;
    setPending(true);
    setError(null);
    try {
      await replaceFormFields(
        selectedForm.fields.filter((field) => field.key !== key),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível remover o campo.",
      );
    } finally {
      setPending(false);
    }
  }
  async function moveFormField(key: string, direction: -1 | 1): Promise<void> {
    if (!selectedForm) return;
    const index = selectedForm.fields.findIndex((field) => field.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= selectedForm.fields.length) return;
    const fields = [...selectedForm.fields];
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    setPending(true);
    setError(null);
    try {
      await replaceFormFields(fields);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível reordenar os campos.",
      );
    } finally {
      setPending(false);
    }
  }
  async function updateFormMetadata(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!selectedForm) return;
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const form = (
        await api<{ form: FormSummary }>(`/v1/forms/${selectedForm.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: selectedForm.version,
            title: values.get("title"),
            description: values.get("description") || null,
          }),
        })
      ).form;
      setSelectedForm(form);
      await refreshForms(form.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar o formulário.",
      );
    } finally {
      setPending(false);
    }
  }
  async function copyPublicLink(): Promise<void> {
    if (!selectedForm) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/f/${selectedForm.publicId}`,
      );
      setError(null);
    } catch {
      setError(
        "Não foi possível copiar automaticamente; copie o link exibido.",
      );
    }
  }
  async function exportFormSubmissions(): Promise<void> {
    if (!selectedForm) return;
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (submissionStatusFilter) query.set("status", submissionStatusFilter);
      const response = await fetch(
        `/api/v1/forms/${selectedForm.id}/submissions/export?${query.toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Não foi possível exportar as respostas.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "respostas.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível exportar as respostas.");
    } finally {
      setPending(false);
    }
  }
  async function publishForm(expiresAt?: string): Promise<void> {
    if (!selectedForm) return;
    setPending(true);
    setError(null);
    try {
      const form = (
        await api<{ form: FormSummary }>(
          `/v1/forms/${selectedForm.id}/publication`,
          {
            method: "POST",
            body: JSON.stringify({
              expectedVersion: selectedForm.version,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            }),
          },
        )
      ).form;
      setSelectedForm(form);
      await refreshForms(form.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível publicar o formulário.",
      );
    } finally {
      setPending(false);
    }
  }
  async function revokeForm(): Promise<void> {
    if (!selectedForm) return;
    setPending(true);
    setError(null);
    try {
      const form = (
        await api<{ form: FormSummary }>(
          `/v1/forms/${selectedForm.id}/publication/revoke`,
          {
            method: "POST",
            body: JSON.stringify({ expectedVersion: selectedForm.version }),
          },
        )
      ).form;
      setSelectedForm(form);
      await refreshForms(form.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível revogar o formulário.",
      );
    } finally {
      setPending(false);
    }
  }

  if (publicFormId) return <PublicFormPage publicId={publicFormId} />;
  if (publicDashboardToken)
    return <PublicDashboardPage token={publicDashboardToken} />;
  if (publicTvDisplayToken)
    return <PublicTvDisplayPage token={publicTvDisplayToken} />;
  if (publicTvPlaylistToken)
    return <PublicTvPlaylistPage token={publicTvPlaylistToken} />;

  if (mode === "loading")
    return (
      <main className="shell">
        <p className="loading">Carregando Builder Solutions…</p>
      </main>
    );
  if (mode === "signed-in" && identity)
    return (
      <DashboardShell
        collapsed={sidebarCollapsed}
        identity={identity}
        onLogout={() => void logout()}
        onNavigate={setWorkspaceView}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        pending={pending}
        unreadNotifications={unreadNotifications}
        view={workspaceView}
      >
        <section
          className="panel dashboard dashboard-wide"
          aria-labelledby="dashboard-title"
        >
          <div className="brand">
            <span className="icon">
              <Building2 aria-hidden="true" />
            </span>
            <span>Builder Solutions</span>
          </div>
          <nav className="workspace-nav" aria-label="Navegação do workspace">
            {(
              [
                ["home", "Visão geral"],
                [
                  "notifications",
                  `Notificações${unreadNotifications ? ` (${unreadNotifications})` : ""}`,
                ],
                ["forms", "Formulários"],
                ["events", "Eventos"],
                ["changes", "Mudanças"],
                ["bash", "BASH"],
                ["hht", "HHT"],
                ["dashboards", "Painéis"],
                ["tv", "TV"],
                ["integrations", "Integrações"],
                ["classifications", "Listas"],
                ["files", "Arquivos"],
                ["organization", "Organização"],
              ] as Array<[WorkspaceView, string]>
            ).map(([view, label]) => (
              <button
                key={view}
                className="workspace-nav-item"
                aria-current={workspaceView === view ? "page" : undefined}
                type="button"
                onClick={() => setWorkspaceView(view)}
              >
                {view === "home" ? (
                  <LayoutDashboard aria-hidden="true" />
                ) : view === "notifications" ? (
                  <Bell aria-hidden="true" />
                ) : view === "forms" || view === "files" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <Settings2 aria-hidden="true" />
                )}{" "}
                {label}
              </button>
            ))}
          </nav>
          {workspaceView === "home" ? (
            <>
              <p className="eyebrow">Workspace</p>
              <h1 id="dashboard-title">Visão geral da empresa</h1>
              <p className="description">
                Olá, {identity.organization.name}. Acompanhe a organização ativa
                e avance pela configuração dos módulos empresariais.
              </p>
              <section className="overview-grid" aria-label="Resumo da empresa">
                <article className="overview-card">
                  <Building2 aria-hidden="true" />
                  <span>Organização ativa</span>
                  <strong>{identity.organization.name}</strong>
                  <small>{identity.organization.slug}</small>
                </article>
                <article className="overview-card">
                  <UsersRound aria-hidden="true" />
                  <span>Seu acesso</span>
                  <strong>{identity.membership.role}</strong>
                  <small>
                    {identity.access.isPlatformAdmin
                      ? "Administrador da plataforma"
                      : "Membro da organização"}
                  </small>
                </article>
                <article className="overview-card">
                  <ClipboardList aria-hidden="true" />
                  <span>Próxima etapa</span>
                  <strong>Configurar módulos</strong>
                  <small>
                    Formulários já estão disponíveis; os demais entram por
                    entregas isoladas.
                  </small>
                </article>
              </section>
              <section className="admin-section" aria-labelledby="start-title">
                <h2 id="start-title">Comece por aqui</h2>
                <p className="section-note">
                  Crie e publique formulários, ou gerencie membros, convites e
                  outras organizações.
                </p>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={() => setWorkspaceView("forms")}
                >
                  <FileText aria-hidden="true" /> Abrir formulários
                </button>
              </section>
            </>
          ) : workspaceView === "notifications" ? (
            <section
              className="admin-section"
              aria-labelledby="notifications-title"
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Central de avisos</p>
                  <h2 id="notifications-title">Notificações</h2>
                </div>
                {unreadNotifications > 0 && (
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={pending}
                    onClick={() => void markAllNotificationsRead()}
                  >
                    Marcar todas como lidas
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="section-note">Você não possui notificações.</p>
              ) : (
                <div className="form-list">
                  {notifications.map((notification) => (
                    <button
                      className="form-row notification-row"
                      data-unread={!notification.readAt || undefined}
                      key={notification.id}
                      type="button"
                      disabled={pending}
                      onClick={() => void openNotification(notification)}
                    >
                      <Bell aria-hidden="true" />
                      <span>
                        <strong>{notification.title}</strong>
                        <small>
                          {notification.body} ·{" "}
                          {new Date(notification.createdAt).toLocaleString(
                            "pt-BR",
                          )}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : workspaceView === "profile" ? (
            <ProfilePage
              identity={identity}
              notice={profileNotice}
              pending={pending}
              onChangePassword={changeOwnPassword}
            />
          ) : workspaceView === "forms" ? (
            <>
              <p className="eyebrow">Módulo empresarial</p>
              <h1 id="dashboard-title">Formulários</h1>
              <p className="description">
                Crie formulários isolados por empresa. Cada criação recebe um
                campo inicial obrigatório, que pode ser configurado pela API
                nesta primeira entrega.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {(identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN") && (
                <form
                  className="inline-form admin-section"
                  onSubmit={createForm}
                >
                  <label>
                    Título
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={160}
                      placeholder="Inspeção de segurança"
                    />
                  </label>
                  <label>
                    Descrição
                    <input
                      name="description"
                      maxLength={10000}
                      placeholder="Opcional"
                    />
                  </label>
                  <button
                    className="primary-button compact"
                    type="submit"
                    disabled={pending}
                  >
                    Criar formulário
                  </button>
                </form>
              )}
              <section className="admin-section" aria-labelledby="forms-title">
                <h2 id="forms-title">Formulários da organização</h2>
                {forms.length === 0 ? (
                  <p className="section-note">
                    Ainda não há formulários nesta empresa.
                  </p>
                ) : (
                  <div className="form-list">
                    {forms.map((form) => (
                      <button
                        className="form-row form-row-button"
                        type="button"
                        key={form.id}
                        onClick={() => void openForm(form.id)}
                        disabled={pending}
                      >
                        <FileText aria-hidden="true" />
                        <div>
                          <strong>{form.title}</strong>
                          <small>
                            {form.status} · versão {form.version} ·{" "}
                            {form.fields.length} campo(s)
                          </small>
                        </div>
                        <code>{form.publicId}</code>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              {selectedForm && (
                <section
                  className="admin-section"
                  aria-labelledby="form-editor-title"
                >
                  <h2 id="form-editor-title">{selectedForm.title}</h2>
                  <p className="section-note">
                    Versão {selectedForm.version} · {selectedForm.status}
                    {selectedForm.status === "PUBLISHED" && (
                      <>
                        {" "}
                        · Link:{" "}
                        <code>
                          {window.location.origin}/f/{selectedForm.publicId}
                        </code>
                      </>
                    )}
                  </p>
                  {(identity.membership.role === "OWNER" ||
                    identity.membership.role === "ADMIN") && (
                    <form className="inline-form" onSubmit={updateFormMetadata}>
                      <label>
                        Título
                        <input
                          name="title"
                          required
                          minLength={2}
                          maxLength={160}
                          defaultValue={selectedForm.title}
                        />
                      </label>
                      <label>
                        Descrição
                        <input
                          name="description"
                          maxLength={10000}
                          defaultValue={selectedForm.description ?? ""}
                        />
                      </label>
                      <button
                        className="secondary-button compact"
                        type="submit"
                        disabled={pending}
                      >
                        Salvar dados
                      </button>
                    </form>
                  )}
                  <div className="form-list">
                    {selectedForm.fields.map((field, index) => (
                      <article className="form-row" key={field.key}>
                        <FileText aria-hidden="true" />
                        <div>
                          <strong>{field.label}</strong>
                          <small>
                            {field.type} ·{" "}
                            {field.required ? "obrigatório" : "opcional"}
                            {field.options.length > 0
                              ? ` · ${field.options.join(", ")}`
                              : ""}
                          </small>
                        </div>
                        {(identity.membership.role === "OWNER" ||
                          identity.membership.role === "ADMIN") && (
                          <span className="field-actions">
                            <button
                              className="secondary-button compact"
                              type="button"
                              onClick={() => void moveFormField(field.key, -1)}
                              disabled={pending || index === 0}
                            >
                              ↑
                            </button>
                            <button
                              className="secondary-button compact"
                              type="button"
                              onClick={() => void moveFormField(field.key, 1)}
                              disabled={
                                pending ||
                                index === selectedForm.fields.length - 1
                              }
                            >
                              ↓
                            </button>
                            <button
                              className="secondary-button compact"
                              type="button"
                              onClick={() => void removeFormField(field.key)}
                              disabled={pending}
                            >
                              Remover
                            </button>
                          </span>
                        )}
                      </article>
                    ))}
                  </div>
                  {(identity.membership.role === "OWNER" ||
                    identity.membership.role === "ADMIN") && (
                    <>
                      <form className="inline-form" onSubmit={addFormField}>
                        <label>
                          Novo campo
                          <input
                            name="label"
                            required
                            minLength={2}
                            maxLength={160}
                          />
                        </label>
                        <label>
                          Tipo
                          <select name="type" defaultValue="SHORT_TEXT">
                            <option value="SHORT_TEXT">Texto curto</option>
                            <option value="LONG_TEXT">Texto longo</option>
                            <option value="NUMBER">Número</option>
                            <option value="DATE">Data</option>
                            <option value="SELECT">Seleção única</option>
                            <option value="MULTI_SELECT">
                              Seleção múltipla
                            </option>
                            <option value="CHECKBOX">Confirmação</option>
                          </select>
                        </label>
                        <label>
                          Opções
                          <input
                            name="options"
                            maxLength={1000}
                            placeholder="Uma, duas, três"
                          />
                        </label>
                        <label className="checkbox-label">
                          <input name="required" type="checkbox" /> Obrigatório
                        </label>
                        <button
                          className="secondary-button compact"
                          type="submit"
                          disabled={pending}
                        >
                          Adicionar campo
                        </button>
                      </form>
                      <div className="action-row">
                        {selectedForm.status === "PUBLISHED" ? (
                          <>
                            <button
                              className="secondary-button compact"
                              type="button"
                              onClick={() => void copyPublicLink()}
                              disabled={pending}
                            >
                              Copiar link
                            </button>
                            <button
                              className="secondary-button compact"
                              type="button"
                              onClick={() => void revokeForm()}
                              disabled={pending}
                            >
                              Revogar link público
                            </button>
                          </>
                        ) : (
                          <form
                            className="inline-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void publishForm(
                                String(
                                  new FormData(event.currentTarget).get(
                                    "expiresAt",
                                  ) ?? "",
                                ),
                              );
                            }}
                          >
                            <label>
                              Expira em (opcional)
                              <input name="expiresAt" type="datetime-local" />
                            </label>
                            <button
                              className="primary-button compact"
                              type="submit"
                              disabled={
                                pending || selectedForm.fields.length === 0
                              }
                            >
                              Publicar e gerar novo link
                            </button>
                          </form>
                        )}
                      </div>
                    </>
                  )}
                  <h3>Respostas</h3>
                  <form
                    className="inline-form compact-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loadSubmissions(
                        selectedForm.id,
                        1,
                        submissionStatusFilter,
                      );
                    }}
                  >
                    <label>
                      Status
                      <select
                        aria-label="Filtrar respostas por status"
                        value={submissionStatusFilter}
                        onChange={(event) =>
                          setSubmissionStatusFilter(
                            event.currentTarget.value as
                              FormSubmission["status"] | "",
                          )
                        }
                      >
                        <option value="">Todas</option>
                        <option value="RECEIVED">Recebidas</option>
                        <option value="IN_REVIEW">Em análise</option>
                        <option value="RESOLVED">Resolvidas</option>
                        <option value="REJECTED">Rejeitadas</option>
                      </select>
                    </label>
                    <button
                      className="secondary-button compact"
                      type="submit"
                      disabled={pending}
                    >
                      Filtrar
                    </button>
                    <small>{submissionPagination.total} resposta(s)</small>
                    {(identity.membership.role === "OWNER" ||
                      identity.membership.role === "ADMIN") && (
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={pending}
                        onClick={() => void exportFormSubmissions()}
                      >
                        Exportar CSV
                      </button>
                    )}
                  </form>
                  {submissions.length === 0 ? (
                    <p className="section-note">
                      Ainda não há respostas para este filtro.
                    </p>
                  ) : (
                    <div className="form-list">
                      {submissions.map((submission) => (
                        <article
                          className="form-row event-detail"
                          key={submission.id}
                        >
                          <ClipboardList aria-hidden="true" />
                          <div>
                            <strong>{submission.status}</strong>
                            <small>
                              Versão {submission.formVersion} ·{" "}
                              {new Date(submission.submittedAt).toLocaleString(
                                "pt-BR",
                              )}
                            </small>
                            <dl className="identity-card">
                              {(submission.formSnapshot.fields ?? []).map(
                                (field) => (
                                  <div key={field.key}>
                                    <dt>{field.label}</dt>
                                    <dd>
                                      {formatSubmissionAnswer(
                                        submission.answers[field.key],
                                      )}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                            {(identity.membership.role === "OWNER" ||
                              identity.membership.role === "ADMIN") && (
                              <div className="action-row">
                                <select
                                  aria-label={`Novo status da resposta ${submission.id}`}
                                  defaultValue=""
                                >
                                  <option value="" disabled>
                                    Tratar resposta
                                  </option>
                                  {submission.status === "RECEIVED" && (
                                    <>
                                      <option value="IN_REVIEW">
                                        Iniciar análise
                                      </option>
                                      <option value="REJECTED">Rejeitar</option>
                                    </>
                                  )}
                                  {submission.status === "IN_REVIEW" && (
                                    <>
                                      <option value="RESOLVED">Resolver</option>
                                      <option value="REJECTED">Rejeitar</option>
                                    </>
                                  )}
                                </select>
                                <button
                                  className="secondary-button compact"
                                  type="button"
                                  disabled={
                                    pending ||
                                    submission.status === "RESOLVED" ||
                                    submission.status === "REJECTED"
                                  }
                                  onClick={(event) => {
                                    const status = (
                                      event.currentTarget
                                        .previousElementSibling as HTMLSelectElement | null
                                    )?.value as
                                      FormSubmission["status"] | undefined;
                                    if (status)
                                      void updateSubmissionStatus(
                                        submission,
                                        status,
                                      );
                                  }}
                                >
                                  Salvar tratativa
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {submissionPagination.total >
                    submissionPagination.pageSize && (
                    <div className="action-row">
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={pending || submissionPagination.page === 1}
                        onClick={() =>
                          void loadSubmissions(
                            selectedForm.id,
                            submissionPagination.page - 1,
                          )
                        }
                      >
                        Anterior
                      </button>
                      <span>Página {submissionPagination.page}</span>
                      <button
                        className="secondary-button compact"
                        type="button"
                        disabled={
                          pending ||
                          submissionPagination.page *
                            submissionPagination.pageSize >=
                            submissionPagination.total
                        }
                        onClick={() =>
                          void loadSubmissions(
                            selectedForm.id,
                            submissionPagination.page + 1,
                          )
                        }
                      >
                        Próxima
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          ) : workspaceView === "organization" ? (
            <>
              <div className="success-icon">
                <CheckCircle2 aria-hidden="true" />
              </div>
              <p className="eyebrow">Administração</p>
              <h1 id="dashboard-title">Organização e acesso</h1>
              <p className="description">
                Gerencie o contexto ativo, membros e convites sem sair do
                workspace.
              </p>
              <dl className="identity-card">
                <div>
                  <dt>Conta</dt>
                  <dd>{identity.user.email}</dd>
                </div>
                <div>
                  <dt>Organização</dt>
                  <dd>{identity.organization.slug}</dd>
                </div>
                <div>
                  <dt>Permissão</dt>
                  <dd>
                    {identity.access.isPlatformAdmin ? "SUPERADMIN · " : ""}
                    {identity.membership.role}
                  </dd>
                </div>
              </dl>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <section
                className="admin-section"
                aria-labelledby="organizations-title"
              >
                <h2 id="organizations-title">Organizações</h2>
                <form className="inline-form" onSubmit={switchOrganization}>
                  <label>
                    Contexto ativo
                    <select
                      name="organizationId"
                      defaultValue={identity.organization.id}
                      disabled={pending}
                    >
                      {organizations.map((organization) => (
                        <option value={organization.id} key={organization.id}>
                          {organization.name} · {organization.membership.role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button compact"
                    type="submit"
                    disabled={pending || organizations.length < 2}
                  >
                    Trocar organização
                  </button>
                </form>
                {identity.access.isPlatformAdmin && (
                  <form className="inline-form" onSubmit={createOrganization}>
                    <label>
                      Nova organização
                      <input
                        name="name"
                        minLength={2}
                        maxLength={160}
                        required
                        placeholder="Nome da organização"
                      />
                    </label>
                    <label>
                      Identificador
                      <input
                        name="slug"
                        minLength={3}
                        maxLength={63}
                        pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]{3,}"
                        required
                        placeholder="empresa-exemplo"
                      />
                    </label>
                    <button
                      className="primary-button compact"
                      type="submit"
                      disabled={pending}
                    >
                      Criar organização
                    </button>
                  </form>
                )}
              </section>
              {(identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN") && (
                <section
                  className="admin-section"
                  aria-labelledby="members-title"
                >
                  <h2 id="members-title">Membros</h2>
                  <p className="section-note">
                    Alterações usam o contexto da organização ativa. A própria
                    membership não pode ser alterada nesta tela.
                  </p>
                  <form className="inline-form" onSubmit={createInvitation}>
                    <label>
                      E-mail do novo membro
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="pessoa@empresa.com"
                      />
                    </label>
                    <label>
                      Papel
                      <select name="role" defaultValue="MEMBER">
                        <option
                          value="OWNER"
                          disabled={identity.membership.role !== "OWNER"}
                        >
                          OWNER
                        </option>
                        <option
                          value="ADMIN"
                          disabled={identity.membership.role !== "OWNER"}
                        >
                          ADMIN
                        </option>
                        <option value="MEMBER">MEMBER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </label>
                    <button
                      className="primary-button compact"
                      type="submit"
                      disabled={pending}
                    >
                      Gerar convite
                    </button>
                  </form>
                  {invitationUrl && (
                    <p className="invitation-link">
                      Convite válido por 7 dias: <code>{invitationUrl}</code>
                    </p>
                  )}
                  {invitations.length > 0 && (
                    <div className="invitation-list">
                      {invitations.map((invitation) => (
                        <div className="invitation-row" key={invitation.id}>
                          <span>
                            {invitation.email} · {invitation.role}
                          </span>
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={pending}
                            onClick={() => void revokeInvitation(invitation.id)}
                          >
                            Revogar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="member-list">
                    {members.map((member) => (
                      <form
                        className="member-row"
                        key={member.id}
                        onSubmit={(event) =>
                          void updateMember(event, member.id)
                        }
                      >
                        <span>{member.email}</span>
                        <select
                          name="role"
                          defaultValue={member.role}
                          disabled={
                            pending ||
                            member.id === identity.membership.id ||
                            (identity.membership.role === "ADMIN" &&
                              member.role === "OWNER")
                          }
                        >
                          <option value="OWNER">OWNER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="MEMBER">MEMBER</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                        <select
                          name="status"
                          defaultValue={member.status}
                          disabled={
                            pending ||
                            member.id === identity.membership.id ||
                            (identity.membership.role === "ADMIN" &&
                              member.role === "OWNER")
                          }
                        >
                          <option value="ACTIVE">Ativo</option>
                          <option value="SUSPENDED">Suspenso</option>
                        </select>
                        <button
                          className="secondary-button compact"
                          type="submit"
                          disabled={
                            pending ||
                            member.id === identity.membership.id ||
                            (identity.membership.role === "ADMIN" &&
                              member.role === "OWNER")
                          }
                        >
                          Salvar
                        </button>
                      </form>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : workspaceView === "events" ? (
            <EventsModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "changes" ? (
            <ChangesModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
              canApprove={identity.membership.role !== "VIEWER"}
              identity={identity}
            />
          ) : workspaceView === "bash" ? (
            <BashModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "hht" ? (
            <HhtModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "dashboards" ? (
            <DashboardsModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "tv" ? (
            <TvModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "integrations" ? (
            <IntegrationsModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : workspaceView === "files" ? (
            <FilesModulePage
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          ) : (
            <OperationalModulePage
              view={workspaceView}
              canManage={
                identity.membership.role === "OWNER" ||
                identity.membership.role === "ADMIN"
              }
            />
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={() => void logout()}
            disabled={pending}
          >
            <LogOut aria-hidden="true" /> Sair
          </button>
        </section>
      </DashboardShell>
    );

  if (mode === "change-password")
    return (
      <main className="shell">
        <section className="panel" aria-labelledby="title">
          <div className="brand">
            <span className="icon">
              <Building2 aria-hidden="true" />
            </span>
            <span>Builder Solutions</span>
          </div>
          <p className="eyebrow">Senha temporária</p>
          <h1 id="title">Defina uma nova senha segura.</h1>
          <p className="description">
            Por segurança, a senha temporária só permite este passo. Escolha uma
            senha exclusiva, com ao menos 12 caracteres.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <form className="auth-form" onSubmit={submitPasswordChange}>
            <label>
              Senha temporária
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label>
              Nova senha
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                placeholder="Mínimo de 12 caracteres"
              />
            </label>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? "Atualizando…" : "Atualizar senha e continuar"}
            </button>
          </form>
          <p className="security-note">
            <ShieldCheck aria-hidden="true" /> A troca encerra as demais sessões
            ativas desta conta.
          </p>
        </section>
      </main>
    );

  if (mode === "invite")
    return (
      <main className="shell">
        <section className="panel" aria-labelledby="title">
          <div className="brand">
            <span className="icon">
              <Building2 aria-hidden="true" />
            </span>
            <span>Builder Solutions</span>
          </div>
          <p className="eyebrow">Convite de organização</p>
          <h1 id="title">Defina seu acesso.</h1>
          <p className="description">
            Se esta é sua primeira organização, escolha uma senha segura. Se já
            possui uma conta, entre abaixo para associar o convite sem trocar
            sua senha.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <form className="auth-form" onSubmit={acceptInvitation}>
            <label>
              Nova senha
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                placeholder="Mínimo de 12 caracteres"
              />
            </label>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? "Concluindo…" : "Criar acesso e aceitar convite"}
            </button>
          </form>
          <section className="admin-section">
            <h2>Já possui uma conta?</h2>
            <form
              className="auth-form"
              onSubmit={acceptInvitationAsExistingUser}
            >
              <label>
                E-mail
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Senha atual
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <button
                className="secondary-button"
                type="submit"
                disabled={pending}
              >
                Entrar e aceitar convite
              </button>
            </form>
          </section>
        </section>
      </main>
    );

  const bootstrap = mode === "bootstrap";
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="title">
        <div className="brand">
          <span className="icon">
            <Building2 aria-hidden="true" />
          </span>
          <span>Builder Solutions</span>
        </div>
        <p className="eyebrow">
          {bootstrap ? "Primeira configuração" : "Acesso à plataforma"}
        </p>
        <h1 id="title">
          {bootstrap
            ? "Crie a conta administradora."
            : "Entre na sua organização."}
        </h1>
        <p className="description">
          {bootstrap
            ? "Esta etapa acontece uma única vez e cria a organização inicial com permissão de proprietário."
            : "Use o e-mail e a senha definidos pelo administrador da sua organização."}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form
          className="auth-form"
          onSubmit={bootstrap ? submitBootstrap : submitLogin}
        >
          {bootstrap && (
            <>
              <label>
                Código de instalação
                <input
                  name="bootstrapToken"
                  type="password"
                  autoComplete="off"
                  minLength={32}
                  required
                  placeholder="Definido no Dokploy"
                />
              </label>
              <label>
                Nome da organização
                <input
                  name="organizationName"
                  autoComplete="organization"
                  minLength={2}
                  maxLength={160}
                  required
                  placeholder="Minha empresa"
                />
              </label>
              <label>
                Identificador da organização
                <input
                  name="organizationSlug"
                  autoComplete="off"
                  minLength={3}
                  maxLength={63}
                  pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]{3,}"
                  required
                  placeholder="minha-empresa"
                />
              </label>
            </>
          )}
          <label>
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@empresa.com"
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete={bootstrap ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              required
              placeholder="Mínimo de 12 caracteres"
            />
          </label>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending
              ? "Processando…"
              : bootstrap
                ? "Criar acesso seguro"
                : "Entrar"}
          </button>
        </form>
        <p className="security-note">
          <ShieldCheck aria-hidden="true" /> Sessões seguras, credenciais
          protegidas com Argon2id e isolamento por organização.
        </p>
      </section>
    </main>
  );
}

function ProfilePage({
  identity,
  notice,
  pending,
  onChangePassword,
}: {
  identity: Identity;
  notice: string | null;
  pending: boolean;
  onChangePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): React.JSX.Element {
  return (
    <>
      <p className="eyebrow">Sua conta</p>
      <h1 id="dashboard-title">Perfil e segurança</h1>
      <p className="description">
        Consulte o contexto de acesso ativo e mantenha sua credencial protegida.
      </p>
      <section className="profile-grid" aria-label="Informações do perfil">
        <article className="overview-card">
          <UsersRound aria-hidden="true" />
          <span>Conta conectada</span>
          <strong>{identity.user.email}</strong>
          <small>Identidade protegida por sessão segura.</small>
        </article>
        <article className="overview-card">
          <Building2 aria-hidden="true" />
          <span>Organização ativa</span>
          <strong>{identity.organization.name}</strong>
          <small>
            {identity.organization.slug} · {identity.membership.role}
          </small>
        </article>
        <article className="overview-card">
          <ShieldCheck aria-hidden="true" />
          <span>Permissões</span>
          <strong>
            {identity.access.isPlatformAdmin
              ? "Administrador da plataforma"
              : "Membro da organização"}
          </strong>
          <small>O acesso é validado no servidor em cada ação.</small>
        </article>
      </section>
      <section
        className="admin-section profile-security"
        aria-labelledby="profile-password-title"
      >
        <h2 id="profile-password-title">Alterar senha</h2>
        <p className="section-note">
          Use uma senha exclusiva, com pelo menos 12 caracteres. A alteração
          encerra as demais sessões abertas nesta conta.
        </p>
        {notice && (
          <p className="profile-notice" role="status">
            {notice}
          </p>
        )}
        <form
          className="inline-form"
          onSubmit={(event) => void onChangePassword(event)}
        >
          <label>
            Senha atual
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label>
            Nova senha
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              placeholder="Mínimo de 12 caracteres"
            />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            {pending ? "Atualizando…" : "Atualizar senha"}
          </button>
        </form>
      </section>
    </>
  );
}

function PublicFormPage({ publicId }: { publicId: string }): React.JSX.Element {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setForm(
          (await api<{ form: PublicForm }>(`/v1/public/forms/${publicId}`))
            .form,
        );
      } catch {
        setError("Este formulário não está disponível.");
      }
    })();
  }, [publicId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form) return;
    const values = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      form.fields.map((field) => {
        const raw = values.get(field.key);
        const selected = values.getAll(field.key);
        const value =
          field.type === "MULTI_SELECT"
            ? selected.length === 0
              ? undefined
              : selected
            : field.type === "NUMBER"
              ? raw === null || raw === ""
                ? undefined
                : Number(raw)
              : field.type === "CHECKBOX"
                ? raw === "on"
                : raw === ""
                  ? undefined
                  : raw;
        return [field.key, value];
      }),
    );
    setPending(true);
    setError(null);
    try {
      await api(`/v1/public/forms/${publicId}/submissions`, {
        method: "POST",
        body: JSON.stringify(answers),
      });
      setSubmitted(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível enviar suas respostas.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!form && !error)
    return (
      <main className="shell">
        <p className="loading">Carregando formulário…</p>
      </main>
    );
  if (!form)
    return (
      <main className="shell">
        <section className="panel">
          <h1>Formulário indisponível</h1>
          <p className="description">{error}</p>
        </section>
      </main>
    );
  if (submitted)
    return (
      <main className="shell">
        <section className="panel">
          <div className="success-icon">
            <CheckCircle2 aria-hidden="true" />
          </div>
          <p className="eyebrow">Recebido</p>
          <h1>Resposta enviada.</h1>
          <p className="description">Obrigado por preencher este formulário.</p>
        </section>
      </main>
    );
  return (
    <main className="shell">
      <section className="panel" aria-labelledby="public-form-title">
        <div className="brand">
          <span className="icon">
            <Building2 aria-hidden="true" />
          </span>
          <span>Builder Solutions</span>
        </div>
        <p className="eyebrow">Formulário</p>
        <h1 id="public-form-title">{form.title}</h1>
        {form.description && <p className="description">{form.description}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <form className="auth-form" onSubmit={submit}>
          {form.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.type === "LONG_TEXT" ? (
                <textarea
                  name={field.key}
                  required={field.required}
                  maxLength={10000}
                />
              ) : field.type === "SELECT" ? (
                <select
                  name={field.key}
                  required={field.required}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {field.options.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "MULTI_SELECT" ? (
                <select name={field.key} required={field.required} multiple>
                  {field.options.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "CHECKBOX" ? (
                <input
                  name={field.key}
                  type="checkbox"
                  required={field.required}
                />
              ) : (
                <input
                  name={field.key}
                  type={
                    field.type === "NUMBER"
                      ? "number"
                      : field.type === "DATE"
                        ? "date"
                        : "text"
                  }
                  required={field.required}
                />
              )}
            </label>
          ))}
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Enviando…" : "Enviar resposta"}
          </button>
        </form>
      </section>
    </main>
  );
}

type OperationalView = Exclude<
  WorkspaceView,
  | "home"
  | "forms"
  | "notifications"
  | "dashboards"
  | "tv"
  | "integrations"
  | "files"
  | "organization"
  | "profile"
>;

const operationalPages: Record<
  OperationalView,
  {
    title: string;
    description: string;
    endpoint: string;
    property: string;
    createPath: string;
    manageLabel: string;
  }
> = {
  events: {
    title: "Eventos de segurança",
    description:
      "Registre, classifique e acompanhe eventos e suas ações corretivas.",
    endpoint: "/v1/events",
    property: "events",
    createPath: "/v1/events",
    manageLabel: "Novo evento",
  },
  changes: {
    title: "Gestão de mudanças",
    description:
      "Controle solicitações, riscos, aprovações e a implantação em etapas.",
    endpoint: "/v1/changes",
    property: "changes",
    createPath: "/v1/changes",
    manageLabel: "Nova mudança",
  },
  bash: {
    title: "Quadro BASH",
    description:
      "Organize cartões operacionais por estágio, prioridade e responsável.",
    endpoint: "/v1/bash/cards",
    property: "cards",
    createPath: "/v1/bash/cards",
    manageLabel: "Novo cartão",
  },
  hht: {
    title: "HHT e taxas",
    description:
      "Cadastre empresas, informe períodos e acompanhe indicadores normalizados.",
    endpoint: "/v1/hht",
    property: "companies",
    createPath: "/v1/hht/companies",
    manageLabel: "Nova empresa HHT",
  },
  classifications: {
    title: "Listas de classificação",
    description:
      "Mantenha taxonomias empresariais usadas pelos módulos de operação.",
    endpoint: "/v1/classifications",
    property: "items",
    createPath: "/v1/classifications",
    manageLabel: "Novo item",
  },
};

function OperationalModulePage({
  view,
  canManage,
}: {
  view: OperationalView;
  canManage: boolean;
}): React.JSX.Element {
  const page = operationalPages[view];
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await api<Record<string, unknown>>(page.endpoint);
      const value = response[page.property];
      setItems(Array.isArray(value) ? value.filter(isRecord) : []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar este módulo.",
      );
    }
  }, [page.endpoint, page.property]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const title = String(values.get("title") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      await api(page.createPath, {
        method: "POST",
        body: JSON.stringify(operationalPayload(view, title)),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar o registro.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">{page.title}</h1>
      <p className="description">{page.description}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={create}>
          <label>
            Título ou nome
            <input
              name="title"
              required
              minLength={2}
              maxLength={200}
              placeholder={page.manageLabel}
            />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            {pending ? "Salvando…" : page.manageLabel}
          </button>
        </form>
      )}
      <section className="admin-section" aria-labelledby={`${view}-list-title`}>
        <h2 id={`${view}-list-title`}>Registros da organização</h2>
        {items.length === 0 ? (
          <p className="section-note">Nenhum registro ainda.</p>
        ) : (
          <div className="form-list">
            {items.map((item, index) => (
              <article
                className="form-row"
                key={typeof item.id === "string" ? item.id : index}
              >
                <Settings2 aria-hidden="true" />
                <div>
                  <strong>{recordTitle(item)}</strong>
                  <small>{recordSummary(item)}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function IntegrationsModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [integrations, setIntegrations] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [configurationStates, setConfigurationStates] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      setIntegrations(
        (
          await api<{ integrations: Array<Record<string, unknown>> }>(
            "/v1/integrations",
          )
        ).integrations,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar as integrações.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/integrations", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          type: values.get("type"),
          status: values.get("status"),
          secretRef: String(values.get("secretRef") ?? "").trim() || null,
          config: parseIntegrationConfig(String(values.get("config") ?? "{}")),
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível cadastrar a integração.",
      );
    } finally {
      setPending(false);
    }
  }

  async function update(
    event: FormEvent<HTMLFormElement>,
    integrationId: string,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/integrations/${integrationId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: values.get("name"),
          status: values.get("status"),
          secretRef: String(values.get("secretRef") ?? "").trim() || null,
          config: parseIntegrationConfig(String(values.get("config") ?? "{}")),
        }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível salvar a integração.",
      );
    } finally {
      setPending(false);
    }
  }

  async function checkConfiguration(integrationId: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await api<{ configuration: { state: string } }>(
        `/v1/integrations/${integrationId}/configuration/check`,
        { method: "POST" },
      );
      setConfigurationStates((current) => ({
        ...current,
        [integrationId]: result.configuration.state,
      }));
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível verificar a configuração.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">Integrações</h1>
      <p className="description">
        Configure conexões por organização sem gravar credenciais no banco. O
        segredo permanece como variável protegida no Dokploy.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={create}>
          <label>
            Nome
            <input
              name="name"
              required
              minLength={2}
              maxLength={160}
              placeholder="Webhook de incidentes"
            />
          </label>
          <label>
            Tipo
            <select name="type" defaultValue="WEBHOOK">
              <option value="WEBHOOK">Webhook</option>
              <option value="EMAIL">E-mail</option>
              <option value="SMARTSHEET">Smartsheet</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="OBJECT_STORAGE">Armazenamento de objetos</option>
              <option value="AI">IA</option>
            </select>
          </label>
          <label>
            Estado
            <select name="status" defaultValue="DISABLED">
              <option value="DISABLED">Desativada</option>
              <option value="ACTIVE">Ativa</option>
            </select>
          </label>
          <label>
            Referência de segredo
            <input
              name="secretRef"
              pattern="INTEGRATION_[A-Z][A-Z0-9_]{0,107}"
              maxLength={120}
              placeholder="INTEGRATION_SUA_EMPRESA_WEBHOOK_SECRET"
            />
          </label>
          <label>
            Configuração não sensível (JSON)
            <textarea name="config" defaultValue="{}" maxLength={10000} />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            Cadastrar integração
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Conexões da organização</h2>
        <p className="section-note">
          O teste valida somente a presença da variável protegida no runtime.
          Ele não expõe segredos nem faz chamadas externas.
        </p>
        {integrations.length === 0 ? (
          <p className="section-note">Nenhuma integração configurada.</p>
        ) : (
          <div className="form-list">
            {integrations.map((integration) => {
              const integrationId = stringValue(integration.id);
              const config = isRecord(integration.config)
                ? integration.config
                : {};
              const state = integrationId
                ? configurationStates[integrationId]
                : undefined;
              return (
                <article
                  className="form-row event-detail"
                  key={integrationId ?? recordTitle(integration)}
                >
                  <Settings2 aria-hidden="true" />
                  <div>
                    <strong>{recordTitle(integration)}</strong>
                    <small>
                      {String(integration.type)} · {String(integration.status)}{" "}
                      ·{" "}
                      {stringValue(integration.secretRef) ??
                        "sem referência de segredo"}
                    </small>
                    {state && (
                      <p className="section-note">
                        Verificação: {integrationConfigurationLabel(state)}
                      </p>
                    )}
                    {canManage && integrationId && (
                      <>
                        <form
                          className="inline-form compact-form"
                          onSubmit={(event) =>
                            void update(event, integrationId)
                          }
                        >
                          <label>
                            Nome
                            <input
                              name="name"
                              required
                              minLength={2}
                              maxLength={160}
                              defaultValue={recordTitle(integration)}
                            />
                          </label>
                          <label>
                            Estado
                            <select
                              name="status"
                              defaultValue={String(
                                integration.status ?? "DISABLED",
                              )}
                            >
                              <option value="DISABLED">Desativada</option>
                              <option value="ACTIVE">Ativa</option>
                            </select>
                          </label>
                          <label>
                            Referência de segredo
                            <input
                              name="secretRef"
                              pattern="INTEGRATION_[A-Z][A-Z0-9_]{0,107}"
                              maxLength={120}
                              defaultValue={
                                stringValue(integration.secretRef) ?? ""
                              }
                            />
                          </label>
                          <label>
                            Configuração não sensível (JSON)
                            <textarea
                              name="config"
                              defaultValue={JSON.stringify(config, null, 2)}
                              maxLength={10000}
                            />
                          </label>
                          <button
                            className="secondary-button compact"
                            type="submit"
                            disabled={pending}
                          >
                            Salvar
                          </button>
                        </form>
                        <span className="action-row">
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void checkConfiguration(integrationId)
                            }
                          >
                            Verificar configuração
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function parseIntegrationConfig(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    /* the error below is intentionally generic */
  }
  throw new Error("A configuração deve ser um objeto JSON válido.");
}
function integrationConfigurationLabel(state: string): string {
  if (state === "READY") return "variável protegida disponível.";
  if (state === "MISSING_SECRET_REFERENCE")
    return "informe uma referência de segredo antes de ativar.";
  return "variável protegida não encontrada na API; salve-a no Dokploy e faça deploy novamente.";
}

function FilesModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [files, setFiles] = useState<Array<Record<string, unknown>>>([]);
  const [upload, setUpload] = useState<{
    supported: boolean;
    maxByteSize: number;
    contentTypes: string[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [fileResponse, configuration] = await Promise.all([
        api<{ files: Array<Record<string, unknown>> }>("/v1/files"),
        api<{
          upload: {
            supported: boolean;
            maxByteSize: number;
            contentTypes: string[];
          };
        }>("/v1/files/configuration"),
      ]);
      setFiles(fileResponse.files);
      setUpload(configuration.upload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar os arquivos.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function uploadFile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Selecione um arquivo válido.");
      return;
    }
    if (!upload?.supported) {
      setError("O armazenamento privado ainda não está configurado.");
      return;
    }
    if (
      !upload.contentTypes.includes(file.type) ||
      file.size > upload.maxByteSize
    ) {
      setError("O arquivo não atende ao tipo ou tamanho permitido.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const checksum = await sha256Hex(bytes);
      const intent = await api<{
        asset: { id: string };
        upload: { supported: boolean; url: string };
      }>("/v1/files/intents", {
        method: "POST",
        body: JSON.stringify({
          originalName: file.name,
          contentType: file.type,
          byteSize: file.size,
          checksum,
        }),
      });
      if (!intent.upload.supported)
        throw new Error("O armazenamento privado não está disponível.");
      await api(`/v1/files/${intent.asset.id}/content`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes,
      });
      event.currentTarget.reset();
      setNotice(
        "Arquivo enviado e validado. Ele já pode ser vinculado como evidência em uma mudança.",
      );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível enviar o arquivo.",
      );
    } finally {
      setPending(false);
    }
  }

  async function cancelUpload(fileId: string): Promise<void> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/files/${fileId}/cancel`, { method: "POST" });
      setNotice("Upload pendente cancelado com segurança.");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível cancelar o upload.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">Arquivos</h1>
      <p className="description">
        O upload é autenticado, passa pela API e fica privado no armazenamento
        S3 compatível. Links públicos não são gerados.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="section-note" role="status">
          {notice}
        </p>
      )}
      {upload && !upload.supported && (
        <section className="admin-section">
          <h2>Armazenamento pendente</h2>
          <p className="section-note">
            Configure o armazenamento privado no Dokploy. O scanner interno
            também precisa estar saudável. Nenhuma intenção de upload será
            criada até que a cadeia esteja disponível.
          </p>
        </section>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={uploadFile}>
          <label>
            Arquivo
            <input
              name="file"
              type="file"
              required
              accept=".pdf,image/jpeg,image/png,.xlsx,.docx"
              disabled={!upload?.supported || pending}
            />
          </label>
          <p className="section-note">
            PDF, JPG, PNG, XLSX ou DOCX · até{" "}
            {upload
              ? `${Math.floor(upload.maxByteSize / (1024 * 1024))} MB`
              : "…"}
            .
          </p>
          <button
            className="primary-button compact"
            type="submit"
            disabled={!upload?.supported || pending}
          >
            {pending ? "Enviando…" : "Enviar arquivo"}
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Arquivos da organização</h2>
        {files.length === 0 ? (
          <p className="section-note">Nenhum arquivo enviado.</p>
        ) : (
          <div className="form-list">
            {files.map((file) => {
              const id = stringValue(file.id);
              const ready = file.status === "READY";
              const cancellable =
                file.status === "PENDING" || file.status === "QUARANTINED";
              return (
                <article className="form-row" key={id ?? recordTitle(file)}>
                  <FileText aria-hidden="true" />
                  <div>
                    <strong>{recordTitle(file)}</strong>
                    <small>
                      {String(file.status)} · {formatFileSize(file.byteSize)} ·
                      ID {id ?? "indisponível"}
                    </small>
                    {ready && id && (
                      <span className="action-row">
                        <a
                          className="secondary-button compact"
                          href={`/api/v1/files/${id}/download`}
                        >
                          Baixar
                        </a>
                      </span>
                    )}
                    {canManage && cancellable && id && (
                      <span className="action-row">
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={pending}
                          onClick={() => void cancelUpload(id)}
                        >
                          Cancelar upload
                        </button>
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
function formatFileSize(value: unknown): string {
  return typeof value === "number"
    ? `${(value / 1024).toFixed(1)} KB`
    : "tamanho indisponível";
}

function EventsModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      setEvents(
        (await api<{ events: Array<Record<string, unknown>> }>("/v1/events"))
          .events,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar os eventos.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/events", {
        method: "POST",
        body: JSON.stringify({
          code: values.get("code"),
          title: values.get("title"),
          origin: values.get("origin"),
          occurredAt: new Date(String(values.get("occurredAt"))).toISOString(),
          site: values.get("site") || null,
          area: values.get("area") || null,
          description: values.get("description") || null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível registrar o evento.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addAction(
    eventId: string,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/events/${eventId}/actions`, {
        method: "POST",
        body: JSON.stringify({
          title: values.get("title"),
          owner: values.get("owner") || null,
          dueAt: values.get("dueAt")
            ? new Date(String(values.get("dueAt"))).toISOString()
            : null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível adicionar a ação.",
      );
    } finally {
      setPending(false);
    }
  }
  async function completeAction(
    eventId: string,
    actionId: string,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/events/${eventId}/actions/${actionId}/complete`, {
        method: "PATCH",
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível concluir a ação.",
      );
    } finally {
      setPending(false);
    }
  }
  async function transition(
    eventId: string,
    version: number,
    status: string,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/events/${eventId}/status`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: version, status }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar o estado.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">Eventos de segurança</h1>
      <p className="description">
        Registre ocorrências, ações corretivas e o ciclo de resolução. O sistema
        impede fechar um evento que tenha ações pendentes.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={create}>
          <label>
            Código
            <input
              name="code"
              required
              minLength={2}
              maxLength={32}
              placeholder="EV-2026-001"
            />
          </label>
          <label>
            Título
            <input name="title" required minLength={2} maxLength={200} />
          </label>
          <label>
            Origem
            <input
              name="origin"
              required
              minLength={2}
              maxLength={80}
              defaultValue="MANUAL"
            />
          </label>
          <label>
            Ocorrido em
            <input
              name="occurredAt"
              type="datetime-local"
              required
              defaultValue={new Date().toISOString().slice(0, 16)}
            />
          </label>
          <label>
            Unidade
            <input name="site" maxLength={160} />
          </label>
          <label>
            Área
            <input name="area" maxLength={160} />
          </label>
          <label>
            Descrição
            <textarea name="description" maxLength={10000} />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            Registrar evento
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Ocorrências da organização</h2>
        {events.length === 0 ? (
          <p className="section-note">Nenhum evento registrado.</p>
        ) : (
          <div className="form-list">
            {events.map((safetyEvent) => {
              const eventId = stringValue(safetyEvent.id);
              const version =
                typeof safetyEvent.version === "number"
                  ? safetyEvent.version
                  : 0;
              const actions = Array.isArray(safetyEvent.actions)
                ? safetyEvent.actions.filter(isRecord)
                : [];
              return (
                <article
                  className="form-row event-detail"
                  key={eventId ?? recordTitle(safetyEvent)}
                >
                  <Settings2 aria-hidden="true" />
                  <div>
                    <strong>
                      {stringValue(safetyEvent.code) ?? "EV"} ·{" "}
                      {recordTitle(safetyEvent)}
                    </strong>
                    <small>
                      {stringValue(safetyEvent.status) ?? "DRAFT"} ·{" "}
                      {stringValue(safetyEvent.site) ?? "Sem unidade"} ·{" "}
                      {actions.filter((action) => !action.completedAt).length}{" "}
                      ação(ões) pendente(s)
                    </small>
                    {actions.length > 0 && (
                      <ul className="nested-list">
                        {actions.map((action) => (
                          <li
                            key={stringValue(action.id) ?? recordTitle(action)}
                          >
                            {recordTitle(action)}{" "}
                            {action.completedAt ? (
                              "· concluída"
                            ) : (
                              <>
                                {canManage &&
                                  eventId &&
                                  stringValue(action.id) && (
                                    <button
                                      className="secondary-button compact"
                                      type="button"
                                      disabled={pending}
                                      onClick={() =>
                                        void completeAction(
                                          eventId,
                                          stringValue(action.id)!,
                                        )
                                      }
                                    >
                                      Concluir
                                    </button>
                                  )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canManage && eventId && (
                      <>
                        <form
                          className="inline-form compact-form"
                          onSubmit={(formEvent) =>
                            void addAction(eventId, formEvent)
                          }
                        >
                          <label>
                            Ação corretiva
                            <input
                              name="title"
                              required
                              minLength={2}
                              maxLength={200}
                            />
                          </label>
                          <label>
                            Responsável
                            <input name="owner" maxLength={160} />
                          </label>
                          <label>
                            Prazo
                            <input name="dueAt" type="datetime-local" />
                          </label>
                          <button
                            className="secondary-button compact"
                            type="submit"
                            disabled={pending}
                          >
                            Adicionar ação
                          </button>
                        </form>
                        <div className="action-row">
                          <select
                            aria-label="Novo estado do evento"
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Alterar estado
                            </option>
                            {[
                              "DRAFT",
                              "OPEN",
                              "IN_REVIEW",
                              "RESOLVED",
                              "CLOSED",
                            ].map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={pending || version < 1}
                            onClick={(buttonEvent) => {
                              const status = (
                                buttonEvent.currentTarget
                                  .previousElementSibling as HTMLSelectElement | null
                              )?.value;
                              if (status)
                                void transition(eventId, version, status);
                            }}
                          >
                            Atualizar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function ChangesModulePage({
  canManage,
  canApprove,
  identity,
}: {
  canManage: boolean;
  canApprove: boolean;
  identity: Identity;
}): React.JSX.Element {
  const [changes, setChanges] = useState<Array<Record<string, unknown>>>([]);
  const [readyFiles, setReadyFiles] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const workflowFields: Record<
    number,
    Array<{ key: string; label: string }>
  > = {
    1: [
      { key: "scope", label: "Escopo da mudança" },
      { key: "requester", label: "Solicitante e partes envolvidas" },
    ],
    2: [
      { key: "trigger", label: "Gatilho da mudança" },
      { key: "impact", label: "Impacto esperado" },
    ],
    3: [
      { key: "implementationPlan", label: "Plano de implementação" },
      { key: "rollbackPlan", label: "Plano de retorno" },
    ],
    4: [{ key: "residualRiskAcceptance", label: "Aceite do risco residual" }],
    6: [
      { key: "verificationResult", label: "Resultado da verificação" },
      { key: "closureDecision", label: "Decisão de encerramento" },
    ],
  };
  const load = useCallback(async (): Promise<void> => {
    try {
      const changeResponse = await api<{
        changes: Array<Record<string, unknown>>;
      }>("/v1/changes");
      setChanges(changeResponse.changes);
      if (canManage) {
        const fileResponse = await api<{
          files: Array<Record<string, unknown>>;
        }>("/v1/files");
        setReadyFiles(
          fileResponse.files.filter((file) => file.status === "READY"),
        );
      } else setReadyFiles([]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar as mudanças.",
      );
    }
  }, [canManage]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/changes", {
        method: "POST",
        body: JSON.stringify({
          publicCode: values.get("publicCode"),
          title: values.get("title"),
          description: values.get("description") || null,
          requestedBy: values.get("requestedBy") || null,
          owner: values.get("owner") || null,
          dueAt: values.get("dueAt")
            ? new Date(String(values.get("dueAt"))).toISOString()
            : null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar a mudança.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addRisk(
    changeId: string,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/changes/${changeId}/risks`, {
        method: "POST",
        body: JSON.stringify({
          hazard: values.get("hazard"),
          consequence: values.get("consequence") || null,
          probability: Number(values.get("probability")),
          severity: Number(values.get("severity")),
          controls: values.get("controls") || null,
          owner: values.get("owner") || null,
          dueAt: values.get("dueAt")
            ? new Date(String(values.get("dueAt"))).toISOString()
            : null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível adicionar o risco.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addApproval(
    changeId: string,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/changes/${changeId}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          approverName: values.get("approverName"),
          approverEmail: values.get("approverEmail"),
          role: values.get("role") || null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível solicitar a aprovação.",
      );
    } finally {
      setPending(false);
    }
  }
  async function decideApproval(
    changeId: string,
    approvalId: string,
    version: number,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/changes/${changeId}/approvals/${approvalId}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision: values.get("decision"),
          comment: values.get("comment") || null,
          expectedVersion: version,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível registrar a decisão.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addEvidence(
    changeId: string,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/changes/${changeId}/evidence`, {
        method: "POST",
        body: JSON.stringify({
          fileId: values.get("fileId"),
          category: values.get("category") || null,
          description: values.get("description") || null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível vincular a evidência.",
      );
    } finally {
      setPending(false);
    }
  }
  async function completeStep(
    changeId: string,
    step: number,
    version: number,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const data = Object.fromEntries(
        Array.from(values.entries())
          .filter(([key]) => key.startsWith("workflow."))
          .map(([key, value]) => [
            key.slice("workflow.".length),
            String(value),
          ]),
      );
      await api(`/v1/changes/${changeId}/steps/${step}/complete`, {
        method: "POST",
        body: JSON.stringify({
          notes: values.get("notes"),
          data,
          expectedVersion: version,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível concluir a etapa.",
      );
    } finally {
      setPending(false);
    }
  }
  async function transition(
    changeId: string,
    version: number,
    status: string,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/changes/${changeId}/status`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: version, status }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a etapa.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">Gestão de mudanças</h1>
      <p className="description">
        Registre riscos, defina os aprovadores e conduza a solicitação pelas
        etapas controladas do processo.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={create}>
          <label>
            Código
            <input
              name="publicCode"
              required
              minLength={2}
              maxLength={32}
              placeholder="MUD-2026-001"
            />
          </label>
          <label>
            Título
            <input name="title" required minLength={2} maxLength={200} />
          </label>
          <label>
            Solicitante
            <input name="requestedBy" maxLength={160} />
          </label>
          <label>
            Responsável
            <input name="owner" maxLength={160} />
          </label>
          <label>
            Prazo
            <input name="dueAt" type="datetime-local" />
          </label>
          <label>
            Descrição
            <textarea name="description" maxLength={10000} />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            Criar mudança
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Solicitações da organização</h2>
        {changes.length === 0 ? (
          <p className="section-note">Nenhuma mudança registrada.</p>
        ) : (
          <div className="form-list">
            {changes.map((change) => {
              const changeId = stringValue(change.id);
              const version =
                typeof change.version === "number" ? change.version : 0;
              const status = stringValue(change.status) ?? "DRAFT";
              const risks = Array.isArray(change.risks)
                ? change.risks.filter(isRecord)
                : [];
              const approvals = Array.isArray(change.approvals)
                ? change.approvals.filter(isRecord)
                : [];
              const evidence = Array.isArray(change.evidence)
                ? change.evidence.filter(isRecord)
                : [];
              const workflowSteps = Array.isArray(change.workflowSteps)
                ? change.workflowSteps.filter(isRecord)
                : [];
              const stepLabels = [
                "Informações gerais",
                "Gatilhos e escopo",
                "Plano de implementação",
                "Avaliação de riscos",
                "Aprovação formal",
                "Verificação e encerramento",
              ];
              const transitions: Record<string, string[]> = {
                DRAFT: ["REJECTED"],
                IN_REVIEW: ["APPROVED", "REJECTED"],
                APPROVED: ["IMPLEMENTING"],
              };
              const allowedStatuses = transitions[status] ?? [];
              return (
                <article
                  className="form-row event-detail"
                  key={changeId ?? recordTitle(change)}
                >
                  <Settings2 aria-hidden="true" />
                  <div>
                    <strong>
                      {stringValue(change.publicCode) ?? "MUD"} ·{" "}
                      {recordTitle(change)}
                    </strong>
                    <small>
                      {status} · etapa {String(change.currentStep ?? 1)} ·{" "}
                      {risks.length} risco(s) · {approvals.length}{" "}
                      aprovação(ões)
                    </small>
                    <h3 className="subsection-title">Fluxo controlado</h3>
                    <ol className="nested-list workflow-steps">
                      {stepLabels.map((label, index) => {
                        const step = index + 1;
                        const entry = workflowSteps.find(
                          (item) =>
                            stringValue(item.step) ===
                            [
                              "GENERAL_INFORMATION",
                              "TRIGGERS",
                              "IMPLEMENTATION_PLAN",
                              "RISK_ASSESSMENT",
                              "APPROVAL",
                              "VERIFICATION",
                            ][index],
                        );
                        return (
                          <li key={label}>
                            <strong>
                              {step}. {label}
                            </strong>{" "}
                            ·{" "}
                            {stringValue(entry?.status) ??
                              (step < Number(change.currentStep ?? 1)
                                ? "COMPLETED"
                                : "PENDING")}
                          </li>
                        );
                      })}
                    </ol>
                    {risks.length > 0 && (
                      <ul className="nested-list">
                        {risks.map((risk) => (
                          <li key={stringValue(risk.id) ?? recordTitle(risk)}>
                            {stringValue(risk.hazard) ?? "Risco"} · P
                            {String(risk.probability)} × S
                            {String(risk.severity)} ={" "}
                            {String(
                              risk.score ??
                                Number(risk.probability) *
                                  Number(risk.severity),
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <h3 className="subsection-title">Aprovações</h3>
                    {approvals.length === 0 ? (
                      <p className="section-note">Nenhum aprovador definido.</p>
                    ) : (
                      <ul className="nested-list">
                        {approvals.map((approval) => {
                          const approvalId = stringValue(approval.id);
                          const decision =
                            stringValue(approval.decision) ?? "PENDING";
                          const approvalVersion =
                            typeof approval.version === "number"
                              ? approval.version
                              : 0;
                          const isDesignatedApprover =
                            stringValue(approval.approverUserId) ===
                            identity.user.id;
                          return (
                            <li key={approvalId ?? recordTitle(approval)}>
                              <span>
                                {stringValue(approval.approverName) ??
                                  "Aprovador"}{" "}
                                · {decision}
                                {stringValue(approval.role)
                                  ? ` · ${stringValue(approval.role)}`
                                  : ""}
                              </span>
                              {canApprove &&
                                changeId &&
                                approvalId &&
                                decision === "PENDING" &&
                                isDesignatedApprover && (
                                  <form
                                    className="inline-form compact-form approval-decision-form"
                                    onSubmit={(formEvent) =>
                                      void decideApproval(
                                        changeId,
                                        approvalId,
                                        approvalVersion,
                                        formEvent,
                                      )
                                    }
                                  >
                                    <label>
                                      Decisão
                                      <select
                                        name="decision"
                                        defaultValue="APPROVED"
                                      >
                                        <option value="APPROVED">
                                          Aprovar
                                        </option>
                                        <option value="REJECTED">
                                          Reprovar
                                        </option>
                                      </select>
                                    </label>
                                    <label>
                                      Comentário
                                      <textarea
                                        name="comment"
                                        maxLength={10000}
                                        placeholder="Obrigatório ao reprovar"
                                      />
                                    </label>
                                    <button
                                      className="secondary-button compact"
                                      type="submit"
                                      disabled={pending}
                                    >
                                      Registrar decisão
                                    </button>
                                  </form>
                                )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <h3 className="subsection-title">Evidências</h3>
                    {evidence.length === 0 ? (
                      <p className="section-note">
                        Nenhuma evidência vinculada.
                      </p>
                    ) : (
                      <ul className="nested-list">
                        {evidence.map((item) => {
                          const file = isRecord(item.file) ? item.file : null;
                          const evidenceId = stringValue(item.id);
                          return (
                            <li key={evidenceId ?? recordTitle(item)}>
                              {stringValue(file?.originalName) ?? "Arquivo"}
                              {stringValue(item.category)
                                ? ` · ${stringValue(item.category)}`
                                : ""}
                              {stringValue(item.description)
                                ? ` · ${stringValue(item.description)}`
                                : ""}
                              {changeId && evidenceId && (
                                <button
                                  className="secondary-button compact"
                                  type="button"
                                  onClick={() =>
                                    window.open(
                                      `/api/v1/changes/${changeId}/evidence/${evidenceId}/download`,
                                      "_blank",
                                      "noopener",
                                    )
                                  }
                                >
                                  Baixar
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {canManage &&
                      changeId &&
                      (status === "DRAFT" || status === "IN_REVIEW") && (
                        <form
                          className="inline-form compact-form"
                          onSubmit={(formEvent) =>
                            void addRisk(changeId, formEvent)
                          }
                        >
                          <label>
                            Perigo
                            <input
                              name="hazard"
                              required
                              minLength={2}
                              maxLength={300}
                            />
                          </label>
                          <label>
                            Probabilidade
                            <select name="probability" defaultValue="3">
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Severidade
                            <select name="severity" defaultValue="3">
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Controles
                            <textarea name="controls" maxLength={10000} />
                          </label>
                          <button
                            className="secondary-button compact"
                            type="submit"
                            disabled={pending}
                          >
                            Adicionar risco
                          </button>
                        </form>
                      )}
                    {canManage && changeId && status === "IN_REVIEW" && (
                      <form
                        className="inline-form compact-form"
                        onSubmit={(formEvent) =>
                          void addApproval(changeId, formEvent)
                        }
                      >
                        <label>
                          Nome do aprovador
                          <input
                            name="approverName"
                            required
                            minLength={2}
                            maxLength={160}
                          />
                        </label>
                        <label>
                          E-mail do aprovador
                          <input
                            name="approverEmail"
                            type="email"
                            required
                            maxLength={320}
                          />
                        </label>
                        <label>
                          Papel
                          <input
                            name="role"
                            maxLength={120}
                            placeholder="Ex.: Segurança"
                          />
                        </label>
                        <button
                          className="secondary-button compact"
                          type="submit"
                          disabled={pending}
                        >
                          Solicitar aprovação
                        </button>
                      </form>
                    )}
                    {canManage && changeId && (
                      <form
                        className="inline-form compact-form"
                        onSubmit={(formEvent) =>
                          void addEvidence(changeId, formEvent)
                        }
                      >
                        <label>
                          Arquivo pronto
                          <select
                            name="fileId"
                            required
                            disabled={readyFiles.length === 0}
                          >
                            <option value="">Selecione</option>
                            {readyFiles.map((file) => (
                              <option
                                key={String(file.id)}
                                value={String(file.id)}
                              >
                                {recordTitle(file)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Categoria
                          <input
                            name="category"
                            maxLength={80}
                            placeholder="Ex.: Plano de retorno"
                          />
                        </label>
                        <label>
                          Descrição
                          <input name="description" maxLength={10000} />
                        </label>
                        <button
                          className="secondary-button compact"
                          type="submit"
                          disabled={pending || readyFiles.length === 0}
                        >
                          Vincular evidência
                        </button>
                      </form>
                    )}
                    {canManage &&
                      changeId &&
                      ((status === "DRAFT" &&
                        Number(change.currentStep ?? 1) < 5) ||
                        (status === "IMPLEMENTING" &&
                          Number(change.currentStep ?? 1) === 6)) && (
                        <form
                          className="inline-form compact-form"
                          onSubmit={(formEvent) =>
                            void completeStep(
                              changeId,
                              Number(change.currentStep ?? 1),
                              version,
                              formEvent,
                            )
                          }
                        >
                          {(
                            workflowFields[Number(change.currentStep ?? 1)] ??
                            []
                          ).map((field) => (
                            <label key={field.key}>
                              {field.label}
                              <textarea
                                name={`workflow.${field.key}`}
                                required
                                minLength={2}
                                maxLength={10000}
                              />
                            </label>
                          ))}
                          <label>
                            Registro da etapa {String(change.currentStep ?? 1)}
                            <textarea
                              name="notes"
                              required
                              minLength={10}
                              maxLength={10000}
                              placeholder="Descreva a evidência e a decisão desta etapa"
                            />
                          </label>
                          <button
                            className="primary-button compact"
                            type="submit"
                            disabled={pending}
                          >
                            Concluir etapa
                          </button>
                        </form>
                      )}
                    {canManage && changeId && allowedStatuses.length > 0 && (
                      <div className="action-row">
                        <select
                          aria-label="Nova etapa da mudança"
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Alterar etapa
                          </option>
                          {allowedStatuses.map((nextStatus) => (
                            <option key={nextStatus} value={nextStatus}>
                              {nextStatus}
                            </option>
                          ))}
                        </select>
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={pending || version < 1}
                          onClick={(buttonEvent) => {
                            const nextStatus = (
                              buttonEvent.currentTarget
                                .previousElementSibling as HTMLSelectElement | null
                            )?.value;
                            if (nextStatus)
                              void transition(changeId, version, nextStatus);
                          }}
                        >
                          Atualizar
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function BashModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [cards, setCards] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const stages = ["BACKLOG", "DESIGN", "IN_PROGRESS", "REVIEW", "DONE"];
  const load = useCallback(async (): Promise<void> => {
    try {
      setCards(
        (await api<{ cards: Array<Record<string, unknown>> }>("/v1/bash/cards"))
          .cards,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar o quadro BASH.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/bash/cards", {
        method: "POST",
        body: JSON.stringify({
          title: values.get("title"),
          description: values.get("description") || null,
          client: values.get("client") || null,
          criticality: values.get("criticality") || null,
          assignedTo: values.get("assignedTo") || null,
          dueAt: values.get("dueAt")
            ? new Date(String(values.get("dueAt"))).toISOString()
            : null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar o cartão.",
      );
    } finally {
      setPending(false);
    }
  }
  async function comment(
    cardId: string,
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api(`/v1/bash/cards/${cardId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: values.get("content") }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível comentar no cartão.",
      );
    } finally {
      setPending(false);
    }
  }
  async function move(
    cardId: string,
    version: number,
    stage: string,
    position: unknown,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/bash/cards/${cardId}/move`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: version,
          stage,
          position: Number(position ?? 0),
        }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível mover o cartão.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">Quadro BASH</h1>
      <p className="description">
        Organize a execução por colunas, responsável, criticidade e histórico de
        comentários.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={create}>
          <label>
            Título
            <input name="title" required minLength={2} maxLength={200} />
          </label>
          <label>
            Cliente
            <input name="client" maxLength={160} />
          </label>
          <label>
            Criticidade
            <input name="criticality" maxLength={32} placeholder="Alta" />
          </label>
          <label>
            Responsável
            <input name="assignedTo" maxLength={160} />
          </label>
          <label>
            Prazo
            <input name="dueAt" type="datetime-local" />
          </label>
          <label>
            Descrição
            <textarea name="description" maxLength={10000} />
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending}
          >
            Criar cartão
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Fluxo de trabalho</h2>
        <div className="board">
          {stages.map((stage) => (
            <section className="board-column" key={stage}>
              <h3>{stage}</h3>
              {cards
                .filter((card) => card.stage === stage)
                .map((card) => {
                  const cardId = stringValue(card.id);
                  const version =
                    typeof card.version === "number" ? card.version : 0;
                  const comments = Array.isArray(card.comments)
                    ? card.comments.filter(isRecord)
                    : [];
                  return (
                    <article
                      className="board-card"
                      key={cardId ?? recordTitle(card)}
                    >
                      <strong>{recordTitle(card)}</strong>
                      <small>
                        {stringValue(card.client) ?? "Sem cliente"} ·{" "}
                        {stringValue(card.criticality) ?? "Sem criticidade"} ·{" "}
                        {stringValue(card.assignedTo) ?? "Sem responsável"}
                      </small>
                      {comments.length > 0 && (
                        <ul className="nested-list">
                          {comments.map((item) => (
                            <li key={stringValue(item.id) ?? recordTitle(item)}>
                              {stringValue(item.authorName) ?? "Membro"}:{" "}
                              {stringValue(item.content) ?? ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canManage && cardId && (
                        <>
                          <form
                            className="inline-form compact-form"
                            onSubmit={(formEvent) =>
                              void comment(cardId, formEvent)
                            }
                          >
                            <label>
                              Comentário
                              <input
                                name="content"
                                required
                                minLength={1}
                                maxLength={10000}
                              />
                            </label>
                            <button
                              className="secondary-button compact"
                              type="submit"
                              disabled={pending}
                            >
                              Comentar
                            </button>
                          </form>
                          <div className="action-row">
                            <select
                              aria-label="Coluna do cartão"
                              defaultValue={stage}
                            >
                              {stages.map((option) => (
                                <option value={option} key={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <button
                              className="secondary-button compact"
                              type="button"
                              disabled={pending || version < 1}
                              onClick={(buttonEvent) => {
                                const target = buttonEvent.currentTarget
                                  .previousElementSibling as HTMLSelectElement | null;
                                if (target)
                                  void move(
                                    cardId,
                                    version,
                                    target.value,
                                    card.position,
                                  );
                              }}
                            >
                              Mover
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

function HhtModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [companies, setCompanies] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [windows, setWindows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api<{
        companies: Array<Record<string, unknown>>;
        reports: Array<Record<string, unknown>>;
        windows: Array<Record<string, unknown>>;
      }>("/v1/hht");
      setCompanies(data.companies);
      setReports(data.reports);
      setWindows(data.windows);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar o HHT.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function createCompany(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/hht/companies", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          document: values.get("document") || null,
          site: values.get("site"),
          coordination: values.get("coordination") || null,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível cadastrar a empresa.",
      );
    } finally {
      setPending(false);
    }
  }
  async function saveWindow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/hht/windows", {
        method: "PUT",
        body: JSON.stringify({
          year: Number(values.get("year")),
          month: Number(values.get("month")),
          opensAt: new Date(String(values.get("opensAt"))).toISOString(),
          closesAt: new Date(String(values.get("closesAt"))).toISOString(),
        }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível definir a janela.",
      );
    } finally {
      setPending(false);
    }
  }
  async function saveReport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const companyId = String(values.get("companyId") ?? "");
    const year = Number(values.get("year"));
    const month = Number(values.get("month"));
    const existing = reports.find(
      (report) =>
        report.companyId === companyId &&
        report.year === year &&
        report.month === month,
    );
    const existingVersion =
      typeof existing?.version === "number" ? existing.version : undefined;
    setPending(true);
    setError(null);
    try {
      await api("/v1/hht/reports", {
        method: "PUT",
        body: JSON.stringify({
          companyId,
          year,
          month,
          hhtWorked: Number(values.get("hhtWorked")),
          hhtMeal: Number(values.get("hhtMeal")),
          workforce: Number(values.get("workforce")),
          lostDays: Number(values.get("lostDays")),
          lti: Number(values.get("lti")),
          expectedVersion: existingVersion,
        }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível salvar o relatório.",
      );
    } finally {
      setPending(false);
    }
  }
  async function setReportStatus(
    reportId: string,
    status: string,
    expectedVersion: number,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api(`/v1/hht/reports/${reportId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, expectedVersion }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível alterar o status do relatório.",
      );
    } finally {
      setPending(false);
    }
  }
  const today = new Date();
  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">HHT e taxas</h1>
      <p className="description">
        Cadastre unidades, abra a janela de reporte e acompanhe os indicadores
        normalizados por período.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <>
          <form className="inline-form admin-section" onSubmit={createCompany}>
            <label>
              Empresa/unidade
              <input name="name" required minLength={2} maxLength={200} />
            </label>
            <label>
              Local
              <input name="site" required minLength={2} maxLength={120} />
            </label>
            <label>
              Documento
              <input name="document" maxLength={32} />
            </label>
            <label>
              Coordenação
              <input name="coordination" maxLength={160} />
            </label>
            <button
              className="primary-button compact"
              type="submit"
              disabled={pending}
            >
              Cadastrar unidade
            </button>
          </form>
          <form className="inline-form admin-section" onSubmit={saveWindow}>
            <label>
              Ano
              <input
                name="year"
                type="number"
                defaultValue={today.getFullYear()}
                min="2000"
                max="2200"
                required
              />
            </label>
            <label>
              Mês
              <input
                name="month"
                type="number"
                defaultValue={today.getMonth() + 1}
                min="1"
                max="12"
                required
              />
            </label>
            <label>
              Abre em
              <input
                name="opensAt"
                type="datetime-local"
                required
                defaultValue={today.toISOString().slice(0, 16)}
              />
            </label>
            <label>
              Fecha em
              <input
                name="closesAt"
                type="datetime-local"
                required
                defaultValue={new Date(today.getTime() + 7 * 86400000)
                  .toISOString()
                  .slice(0, 16)}
              />
            </label>
            <button
              className="secondary-button compact"
              type="submit"
              disabled={pending}
            >
              Salvar janela
            </button>
          </form>
          <form className="inline-form admin-section" onSubmit={saveReport}>
            <label>
              Unidade
              <select
                name="companyId"
                required
                disabled={companies.length === 0}
              >
                <option value="">Selecione</option>
                {companies.map((company) => (
                  <option key={String(company.id)} value={String(company.id)}>
                    {recordTitle(company)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ano
              <input
                name="year"
                type="number"
                defaultValue={today.getFullYear()}
                min="2000"
                max="2200"
                required
              />
            </label>
            <label>
              Mês
              <input
                name="month"
                type="number"
                defaultValue={today.getMonth() + 1}
                min="1"
                max="12"
                required
              />
            </label>
            <label>
              HHT trabalhadas
              <input
                name="hhtWorked"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </label>
            <label>
              HHT refeição
              <input
                name="hhtMeal"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </label>
            <label>
              Efetivo
              <input name="workforce" type="number" min="0" required />
            </label>
            <label>
              Dias perdidos
              <input name="lostDays" type="number" min="0" required />
            </label>
            <label>
              Acidentes LTI
              <input name="lti" type="number" min="0" required />
            </label>
            <button
              className="primary-button compact"
              type="submit"
              disabled={pending || companies.length === 0}
            >
              Salvar reporte
            </button>
          </form>
        </>
      )}
      <section className="admin-section">
        <h2>Janelas e relatórios</h2>
        {windows.length > 0 && (
          <p className="section-note">
            Janelas:{" "}
            {windows
              .map(
                (window) =>
                  `${String(window.month).padStart(2, "0")}/${String(window.year)}`,
              )
              .join(", ")}
          </p>
        )}
        {reports.length === 0 ? (
          <p className="section-note">Nenhum relatório registrado.</p>
        ) : (
          <div className="form-list">
            {reports.map((report) => {
              const rate = isRecord(report.rates) ? report.rates : {};
              const reportId = stringValue(report.id);
              const version =
                typeof report.version === "number" ? report.version : 0;
              return (
                <article
                  className="form-row"
                  key={reportId ?? recordTitle(report)}
                >
                  <Settings2 aria-hidden="true" />
                  <div>
                    <strong>
                      {isRecord(report.company)
                        ? recordTitle(report.company)
                        : "Unidade"}{" "}
                      · {String(report.month).padStart(2, "0")}/
                      {String(report.year)}
                    </strong>
                    <small>
                      {String(report.status)} · TRIFR {String(rate.trifr ?? 0)}{" "}
                      · LTISR {String(rate.ltisr ?? 0)}
                    </small>
                  </div>
                  {canManage && reportId && (
                    <span className="field-actions">
                      {report.status === "DRAFT" && (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={pending || version < 1}
                          onClick={() =>
                            void setReportStatus(reportId, "SUBMITTED", version)
                          }
                        >
                          Enviar
                        </button>
                      )}
                      {report.status === "SUBMITTED" && (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={pending || version < 1}
                          onClick={() =>
                            void setReportStatus(reportId, "LOCKED", version)
                          }
                        >
                          Bloquear
                        </button>
                      )}
                    </span>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function TvModulePage({
  canManage,
}: {
  canManage: boolean;
}): React.JSX.Element {
  const [displays, setDisplays] = useState<Array<Record<string, unknown>>>([]);
  const [playlists, setPlaylists] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [dashboards, setDashboards] = useState<Array<Record<string, unknown>>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publicationUrl, setPublicationUrl] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [tv, panel] = await Promise.all([
        api<{
          displays: Array<Record<string, unknown>>;
          playlists: Array<Record<string, unknown>>;
        }>("/v1/tv"),
        api<{ dashboards: Array<Record<string, unknown>> }>("/v1/dashboards"),
      ]);
      setDisplays(tv.displays);
      setPlaylists(tv.playlists);
      setDashboards(
        panel.dashboards.filter((dashboard) => dashboard.published === true),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar a TV.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function createDisplay(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/v1/tv/displays", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          dashboardId: values.get("dashboardId"),
          refreshSeconds: 30,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar a tela.",
      );
    } finally {
      setPending(false);
    }
  }
  async function publishDisplay(
    display: Record<string, unknown>,
    published: boolean,
  ): Promise<void> {
    const displayId = stringValue(display.id);
    const version = typeof display.version === "number" ? display.version : 0;
    if (!displayId || version < 1) return;
    setPending(true);
    setError(null);
    setPublicationUrl(null);
    try {
      const response = await api<{ publication: { token: string } | null }>(
        `/v1/tv/displays/${displayId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ published, expectedVersion: version }),
        },
      );
      if (response.publication)
        setPublicationUrl(
          `${window.location.origin}/tv/${response.publication.token}`,
        );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a publicação da TV.",
      );
    } finally {
      setPending(false);
    }
  }
  async function updateDisplay(
    event: FormEvent<HTMLFormElement>,
    display: Record<string, unknown>,
  ): Promise<void> {
    event.preventDefault();
    const displayId = stringValue(display.id);
    const version = typeof display.version === "number" ? display.version : 0;
    if (!displayId || version < 1) return;
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setPublicationUrl(null);
    try {
      await api(`/v1/tv/displays/${displayId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: values.get("name"),
          refreshSeconds: Number(values.get("refreshSeconds")),
          active: values.get("active") === "on",
          expectedVersion: version,
        }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a tela.",
      );
    } finally {
      setPending(false);
    }
  }
  async function createPlaylist(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const displayIds = values.getAll("displayIds").map(String);
    setPending(true);
    setError(null);
    try {
      await api("/v1/tv/playlists", {
        method: "POST",
        body: JSON.stringify({
          name: values.get("name"),
          intervalSeconds: Number(values.get("intervalSeconds")),
          displayIds,
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar a playlist.",
      );
    } finally {
      setPending(false);
    }
  }
  async function publishPlaylist(
    playlist: Record<string, unknown>,
    published: boolean,
  ): Promise<void> {
    const playlistId = stringValue(playlist.id);
    const version = typeof playlist.version === "number" ? playlist.version : 0;
    if (!playlistId || version < 1) return;
    setPending(true);
    setError(null);
    setPublicationUrl(null);
    try {
      const response = await api<{ publication: { token: string } | null }>(
        `/v1/tv/playlists/${playlistId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ published, expectedVersion: version }),
        },
      );
      if (response.publication)
        setPublicationUrl(
          `${window.location.origin}/tv/playlist/${response.publication.token}`,
        );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar a publicação da playlist.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Módulo empresarial</p>
      <h1 id="dashboard-title">TV operacional</h1>
      <p className="description">
        Cada tela publicada recebe um link secreto próprio e reproduz somente um
        snapshot estático autorizado do painel.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {publicationUrl && (
        <section className="admin-section publication-success">
          <strong>Link da TV criado — copie agora.</strong>
          <p>Por segurança, este token não será exibido novamente.</p>
          <code>{publicationUrl}</code>
          <span className="action-row">
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => void navigator.clipboard.writeText(publicationUrl)}
            >
              Copiar
            </button>
            <a
              className="secondary-button compact"
              href={publicationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
          </span>
        </section>
      )}
      {canManage && (
        <form className="inline-form admin-section" onSubmit={createDisplay}>
          <label>
            Nome da tela
            <input name="name" required minLength={2} maxLength={160} />
          </label>
          <label>
            Painel publicado
            <select
              name="dashboardId"
              required
              disabled={dashboards.length === 0}
            >
              <option value="">Selecione</option>
              {dashboards.map((dashboard) => (
                <option key={String(dashboard.id)} value={String(dashboard.id)}>
                  {recordTitle(dashboard)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button compact"
            type="submit"
            disabled={pending || dashboards.length === 0}
          >
            Criar tela
          </button>
        </form>
      )}
      <section className="admin-section">
        <h2>Telas</h2>
        {displays.length === 0 ? (
          <p className="section-note">Nenhuma tela configurada.</p>
        ) : (
          <div className="form-list">
            {displays.map((display) => (
              <article className="form-row" key={String(display.id)}>
                <Settings2 aria-hidden="true" />
                <div>
                  <strong>{recordTitle(display)}</strong>
                  <small>
                    {display.published === true
                      ? "Publicada"
                      : display.publicRevokedAt
                        ? "Link revogado"
                        : "Rascunho"}{" "}
                    ·{" "}
                    {display.active === false
                      ? "em manutenção"
                      : `atualização a cada ${String(display.refreshSeconds ?? 30)}s`}
                  </small>
                  {canManage && (
                    <>
                      <form
                        className="inline-form"
                        onSubmit={(event) => void updateDisplay(event, display)}
                      >
                        <label>
                          Nome
                          <input
                            name="name"
                            required
                            minLength={2}
                            maxLength={160}
                            defaultValue={recordTitle(display)}
                          />
                        </label>
                        <label>
                          Atualiza em (s)
                          <input
                            name="refreshSeconds"
                            type="number"
                            min="5"
                            max="3600"
                            required
                            defaultValue={String(display.refreshSeconds ?? 30)}
                          />
                        </label>
                        <label>
                          <input
                            name="active"
                            type="checkbox"
                            defaultChecked={display.active !== false}
                          />{" "}
                          Ativa
                        </label>
                        <button
                          className="secondary-button compact"
                          type="submit"
                          disabled={pending}
                        >
                          Salvar
                        </button>
                      </form>
                      <span className="action-row">
                        {display.active !== false && (
                          <button
                            className="primary-button compact"
                            type="button"
                            disabled={pending}
                            onClick={() => void publishDisplay(display, true)}
                          >
                            {display.published === true
                              ? "Gerar novo link"
                              : "Publicar"}
                          </button>
                        )}
                        {display.published === true && (
                          <button
                            className="secondary-button compact"
                            type="button"
                            disabled={pending}
                            onClick={() => void publishDisplay(display, false)}
                          >
                            Revogar
                          </button>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="admin-section">
        <h2>Playlists</h2>
        <p className="section-note">
          Uma playlist alterna snapshots autorizados de telas publicadas.
          Qualquer alteração em uma tela revoga a playlist para exigir uma nova
          publicação.
        </p>
        {canManage && (
          <form className="inline-form" onSubmit={createPlaylist}>
            <label>
              Nome
              <input name="name" required minLength={2} maxLength={160} />
            </label>
            <label>
              Intervalo (s)
              <input
                name="intervalSeconds"
                type="number"
                min="5"
                max="3600"
                required
                defaultValue="30"
              />
            </label>
            <fieldset>
              <legend>Telas publicadas</legend>
              {displays
                .filter(
                  (display) =>
                    display.active !== false && display.published === true,
                )
                .map((display) => (
                  <label key={String(display.id)}>
                    <input
                      name="displayIds"
                      type="checkbox"
                      value={String(display.id)}
                    />{" "}
                    {recordTitle(display)}
                  </label>
                ))}
            </fieldset>
            <button
              className="primary-button compact"
              type="submit"
              disabled={
                pending ||
                !displays.some(
                  (display) =>
                    display.active !== false && display.published === true,
                )
              }
            >
              Criar playlist
            </button>
          </form>
        )}
        {playlists.length === 0 ? (
          <p className="section-note">Nenhuma playlist configurada.</p>
        ) : (
          <div className="form-list">
            {playlists.map((playlist) => (
              <article className="form-row" key={String(playlist.id)}>
                <Settings2 aria-hidden="true" />
                <div>
                  <strong>{recordTitle(playlist)}</strong>
                  <small>
                    {playlist.published === true
                      ? "Publicada"
                      : playlist.publicRevokedAt
                        ? "Link revogado"
                        : "Rascunho"}{" "}
                    · alternância a cada{" "}
                    {String(playlist.intervalSeconds ?? 30)}s
                  </small>
                  {canManage && (
                    <span className="action-row">
                      <button
                        className="primary-button compact"
                        type="button"
                        disabled={pending}
                        onClick={() => void publishPlaylist(playlist, true)}
                      >
                        {playlist.published === true
                          ? "Gerar novo link"
                          : "Publicar"}
                      </button>
                      {playlist.published === true && (
                        <button
                          className="secondary-button compact"
                          type="button"
                          disabled={pending}
                          onClick={() => void publishPlaylist(playlist, false)}
                        >
                          Revogar
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function operationalPayload(
  view: OperationalView,
  title: string,
): Record<string, unknown> {
  const suffix = String(Date.now()).slice(-8);
  if (view === "events")
    return {
      code: `EV-${suffix}`,
      title,
      origin: "MANUAL",
      occurredAt: new Date().toISOString(),
    };
  if (view === "changes") return { publicCode: `MUD-${suffix}`, title };
  if (view === "bash") return { title };
  if (view === "hht") return { name: title, site: "Principal" };
  if (view === "classifications")
    return { category: "event_type", label: title, value: slugValue(title) };
  return {
    originalName: title,
    contentType: "application/octet-stream",
    byteSize: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatSubmissionAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatSubmissionAnswer).join(", ");
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (value === null || value === undefined || value === "")
    return "Não informado";
  return String(value);
}
function recordTitle(record: Record<string, unknown>): string {
  return (
    stringValue(record.title) ??
    stringValue(record.name) ??
    stringValue(record.label) ??
    stringValue(record.originalName) ??
    stringValue(record.code) ??
    "Registro"
  );
}
function recordSummary(record: Record<string, unknown>): string {
  return (
    [
      stringValue(record.status),
      stringValue(record.site),
      stringValue(record.stage),
      stringValue(record.category),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" · ") || "Registro isolado por organização"
  );
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function slugValue(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || `item-${Date.now()}`
  );
}
