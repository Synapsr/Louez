"use client";

import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
  Separator,
  Skeleton,
} from "@louez/ui";
import { WarningIcon } from "@louez/ui/icons";

import { apiErrorKey } from "@/lib/orpc/errors";

import { AgentClientIdentity } from "./agent-client-identity";
import { AgentTermsFields } from "./agent-terms-fields";
import { useAgentConsent } from "./use-agent-consent";
import { shownClientName } from "./util.agent-client";

interface AgentConsentCardProps {
  /** The signed query the authorization server sent the page with. */
  oauthQuery: string;
}

/**
 * The consent page of an agent connection: who asks, the stores, the rights,
 * the confirmation and the tools to grant, then Accept or Refuse. The answer
 * sends the browser back to the agent.
 */
export const AgentConsentCard = ({ oauthQuery }: AgentConsentCardProps) => {
  const t = useTranslations("agentConnections");
  const tErrors = useTranslations("errors");
  const { authorization, terms, setTerms, canAccept, accept, refuse, answer } =
    useAgentConsent(oauthQuery);

  if (authorization.isPending) {
    return (
      <Card>
        <CardPanel className="space-y-4 p-6">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardPanel>
      </Card>
    );
  }

  if (authorization.isError || !authorization.data || !terms) {
    return (
      <Alert variant="error">
        <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <AlertTitle>{t("consent.invalidTitle")}</AlertTitle>
        <AlertDescription>{t("consent.invalidDescription")}</AlertDescription>
      </Alert>
    );
  }

  const { client, stores, offeredBundles, canCreateStores } = authorization.data;
  const clientName = shownClientName(client) ?? t("unknownClient");
  const answerError = answer.error ? apiErrorKey(answer.error) : null;
  // A client that may not create a store sends the user to Louez to create it.
  const noStoreDescription = canCreateStores
    ? "consent.noStoreDescription"
    : "consent.noStoreDescriptionNoCreate";

  return (
    <Card>
      <CardHeader className="space-y-4 p-5 sm:p-6">
        <AgentClientIdentity client={client} size="large" />
        <div className="space-y-1">
          <CardTitle className="text-xl">{t("consent.title", { client: clientName })}</CardTitle>
          <CardDescription>{t("consent.description", { client: clientName })}</CardDescription>
        </div>
      </CardHeader>
      <Separator />
      <CardPanel className="space-y-6 p-5 sm:p-6">
        {stores.length === 0 && (
          <Alert variant="info">
            <AlertTitle>{t("consent.noStoreTitle")}</AlertTitle>
            <AlertDescription>
              {t(noStoreDescription, { client: clientName })}
            </AlertDescription>
          </Alert>
        )}
        <AgentTermsFields
          stores={stores}
          offeredBundles={offeredBundles}
          value={terms}
          onChange={setTerms}
          disabled={answer.isPending}
        />
      </CardPanel>
      <Separator />
      <CardFooter className="flex flex-col gap-3 p-5 sm:p-6">
        {answer.isError && (
          <p className="text-destructive w-full text-sm" role="alert">
            {answerError && tErrors.has(answerError) ? tErrors(answerError) : tErrors("generic")}
          </p>
        )}
        {client.redirectHost && (
          <p className="w-full text-sm">
            {t("consent.redirectNotice", { host: client.redirectHost })}
          </p>
        )}
        {client.loopbackRedirect && (
          <Alert variant="warning" className="w-full">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{t("consent.loopbackWarning")}</AlertDescription>
          </Alert>
        )}
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={refuse} disabled={answer.isPending}>
            {t("consent.refuse")}
          </Button>
          <Button size="lg" onClick={accept} disabled={!canAccept} isPending={answer.isPending}>
            {t("consent.accept")}
          </Button>
        </div>
        <p className="text-muted-foreground w-full text-xs">{t("consent.footer")}</p>
      </CardFooter>
    </Card>
  );
};
