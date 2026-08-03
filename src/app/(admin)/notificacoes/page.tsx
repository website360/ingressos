import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { getRepositories } from "@/repositories";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notificações" };

export default async function NotificationsPage() {
  await requirePermission(PERMISSIONS.DASHBOARD_READ);

  const { operations } = await getRepositories();
  const notifications = await operations.listNotifications();

  const unread = notifications.filter((item) => !item.read_at).length;

  return (
    <>
      <PageHeader
        title="Notificações"
        description={
          unread
            ? `${unread} não ${unread === 1 ? "lida" : "lidas"}`
            : "Novos inscritos, eventos lotados, cancelamentos e check-ins aparecem aqui."
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nenhuma notificação"
          description="Você será avisado quando houver novos inscritos, eventos lotados, cancelamentos ou mudanças em eventos."
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {notifications.map((notification) => {
              const content = (
                <div
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 transition-colors",
                    !notification.read_at && "bg-accent/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      notification.read_at ? "bg-transparent" : "bg-primary",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{notification.title}</p>
                    {notification.body && (
                      <p className="text-sm text-muted-foreground">{notification.body}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="muted">{notification.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(notification.created_at)}
                    </span>
                  </div>
                </div>
              );

              return notification.link ? (
                <Link
                  key={notification.id}
                  href={notification.link}
                  className="block hover:bg-muted/40"
                >
                  {content}
                </Link>
              ) : (
                <div key={notification.id}>{content}</div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
