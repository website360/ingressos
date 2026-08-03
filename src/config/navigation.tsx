import {
  BarChart3,
  Bell,
  Calendar,
  FileSearch,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  ScanLine,
  Users,
  type LucideIcon,
} from "lucide-react";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Item aparece se o usuário tiver AO MENOS UMA destas permissões. */
  permissions: readonly Permission[];
  badgeKey?: "notifications" | "support";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navegação do painel (docs/05, seção 1).
 * O que o usuário não pode acessar não aparece — e a rota continua bloqueada no
 * middleware e na RLS. Três camadas, não uma.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: "Visão geral",
    items: [
      {
        label: "Dashboard",
        href: ROUTES.admin.dashboard,
        icon: LayoutDashboard,
        permissions: [PERMISSIONS.DASHBOARD_READ],
      },
    ],
  },
  {
    label: "Eventos",
    items: [
      {
        label: "Eventos",
        href: ROUTES.admin.events,
        icon: Calendar,
        permissions: [PERMISSIONS.EVENT_READ],
      },
    ],
  },
  {
    label: "Público",
    items: [
      {
        label: "Participantes",
        href: ROUTES.admin.attendees,
        icon: Users,
        permissions: [PERMISSIONS.REGISTRATION_READ],
      },
    ],
  },
  {
    label: "Operação",
    items: [
      {
        label: "Check-ins",
        href: ROUTES.admin.checkins,
        icon: ScanLine,
        permissions: [PERMISSIONS.CHECKIN_READ, PERMISSIONS.CHECKIN_EXECUTE],
      },
    ],
  },
  {
    label: "Análise",
    items: [
      {
        label: "Relatórios",
        href: ROUTES.admin.reports,
        icon: BarChart3,
        permissions: [PERMISSIONS.REPORT_READ],
      },
    ],
  },
  {
    label: "Atendimento",
    items: [
      {
        label: "Suporte",
        href: ROUTES.admin.support,
        icon: LifeBuoy,
        permissions: [PERMISSIONS.SUPPORT_READ],
        badgeKey: "support",
      },
      {
        label: "Notificações",
        href: ROUTES.admin.notifications,
        icon: Bell,
        permissions: [PERMISSIONS.DASHBOARD_READ],
        badgeKey: "notifications",
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        label: "Auditoria",
        href: ROUTES.admin.audit,
        icon: FileSearch,
        permissions: [PERMISSIONS.AUDIT_READ],
      },
      {
        label: "Configurações",
        href: ROUTES.admin.settings.root,
        icon: Settings,
        permissions: [PERMISSIONS.SETTINGS_READ, PERMISSIONS.USER_MANAGE],
      },
    ],
  },
];
