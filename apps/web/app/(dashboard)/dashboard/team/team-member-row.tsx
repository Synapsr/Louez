"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { TeamMember } from "@louez/api/contracts/team";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toastManager,
} from "@louez/ui";
import { StarSolidIcon, UserSolidIcon } from "@louez/ui/icons";

import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { orpc } from "@/lib/orpc/react";

import { teamErrorKey } from "./util.team-errors";

interface TeamMemberRowProps {
  member: TeamMember;
  canManageMembers: boolean;
  readOnly?: boolean;
}

export const TeamMemberRow = ({ member, canManageMembers, readOnly = false }: TeamMemberRowProps) => {
  const t = useTranslations("dashboard.team");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();

  const isOwner = member.role === "owner";

  const removeMutation = useMutation(
    orpc.dashboard.team.removeMember.mutationOptions({
      onSuccess: () => {
        toastManager.add({ title: t("memberRemoved"), type: "success" });
        router.refresh();
      },
      onError: (error) => {
        const { scope, key } = teamErrorKey(error);
        toastManager.add({
          title: scope === "team" && t.has(key) ? t(key) : tErrors("generic"),
          type: "error",
        });
      },
    }),
  );
  const isPending = removeMutation.isPending;

  const handleRemove = () => {
    if (readOnly) return;
    removeMutation.mutate({ id: member.id });
  };

  return (
    <div className="hover:bg-muted/60 flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors sm:px-3">
      <UserAvatar src={member.imageUrl} seed={member.userId} size={40} />

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium">{member.name || member.email}</span>
          <Badge variant={isOwner ? "progress" : "expired"} className="gap-1">
            {isOwner ? <StarSolidIcon /> : <UserSolidIcon />}
            {t(isOwner ? "ownerBadge" : "memberBadge")}
          </Badge>
        </div>
        {member.name && <p className="text-muted-foreground truncate text-sm">{member.email}</p>}
        <p className="text-muted-foreground text-xs">
          {t("addedOn", {
            date: format.dateTime(new Date(member.joinedAt), {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }),
          })}
        </p>
      </div>

      {canManageMembers && !isOwner && (
        <DropdownMenu modal={readOnly ? false : undefined}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={readOnly || isPending}
                aria-label={t("removeMember")}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onClick={handleRemove}>
              {t("removeMember")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
