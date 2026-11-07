"use client";

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";

import {
  agentConnectionsMutations,
  agentConnectionsQueries,
} from "@/lib/queries/agent-connections.queries";

import { defaultAgentTerms, isAgentTermsComplete, type AgentTerms } from "./util.agent-terms";

/**
 * The consent page's state: the pending authorization, the terms the user is
 * choosing (from what was granted before, else the defaults), and the
 * answer, which sends the browser back to the agent.
 */
export const useAgentConsent = (oauthQuery: string) => {
  const authorization = useQuery(agentConnectionsQueries.authorization(oauthQuery));
  const [edited, setTerms] = useState<AgentTerms | null>(null);
  const data = authorization.data;
  const terms =
    edited ??
    (data
      ? defaultAgentTerms(
          data.stores.map((store) => store.id),
          data.current,
        )
      : null);

  const answer = useMutation({
    ...agentConnectionsMutations.authorize(),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });

  const accept = () => {
    if (!terms || !isAgentTermsComplete(terms)) return;
    answer.mutate({ oauthQuery, accept: true, ...terms });
  };
  const refuse = () => answer.mutate({ oauthQuery, accept: false });

  return {
    authorization,
    terms,
    setTerms,
    canAccept: terms !== null && isAgentTermsComplete(terms) && !answer.isPending,
    accept,
    refuse,
    answer,
  };
};
