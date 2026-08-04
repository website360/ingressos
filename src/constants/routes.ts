/** Rotas centralizadas — nenhuma string de rota solta em componente. */
export const ROUTES = {
  home: "/",

  auth: {
    login: "/login",
    forgotPassword: "/esqueci-senha",
    resetPassword: "/redefinir-senha",
    invite: (token: string) => `/convite/${token}`,
    callback: "/auth/callback",
    selectTenant: "/selecionar-empresa",
  },

  admin: {
    dashboard: "/dashboard",
    events: "/eventos",
    eventNew: "/eventos/novo",
    event: (id: string) => `/eventos/${id}`,
    attendees: "/participantes",
    checkins: "/checkins",
    reports: "/relatorios",
    notifications: "/notificacoes",
    settings: {
      root: "/configuracoes",
      company: "/configuracoes/empresa",
      users: "/configuracoes/usuarios",
      permissions: "/configuracoes/permissoes",
      emails: "/configuracoes/emails",
      api: "/configuracoes/api",
    },
    profile: "/perfil",
    security: "/seguranca",
  },

  checkin: {
    root: "/checkin",
    event: (eventId: string) => `/checkin/${eventId}`,
    scanner: (eventId: string) => `/checkin/${eventId}/scanner`,
    search: (eventId: string) => `/checkin/${eventId}/busca`,
  },

  /**
   * Área pública. O prefixo `/evento` evita colisão com as rotas do painel
   * (`/eventos`) — sem ele, um slug de evento poderia sequestrar `/relatorios`
   * ou qualquer rota administrativa futura.
   */
  public: {
    events: "/",
    event: (slug: string) => `/evento/${slug}`,
    registration: (slug: string) => `/evento/${slug}/inscricao`,
    registrationSuccess: (slug: string) => `/evento/${slug}/inscricao/sucesso`,
    ticket: (token: string) => `/ingresso/${token}`,
    calendar: (token: string) => `/api/tickets/${token}/calendar`,
    ticketPdf: (token: string) => `/api/tickets/${token}/pdf`,
  },

  api: {
    exportAttendees: (search?: string) =>
      `/api/exports/participantes/excel${search ? `?${search}` : ""}`,
  },
} as const;

/** Prefixos que exigem sessão. Usado pelo middleware. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/eventos",
  "/participantes",
  "/checkins",
  "/relatorios",
  "/notificacoes",
  "/configuracoes",
  "/perfil",
  "/seguranca",
  "/checkin",
  "/selecionar-empresa",
] as const;

/** Rotas de autenticação: usuário logado é redirecionado para o painel. */
export const AUTH_ROUTES = ["/login", "/esqueci-senha", "/redefinir-senha"] as const;
