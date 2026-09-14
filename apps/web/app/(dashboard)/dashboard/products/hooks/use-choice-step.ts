import { useState } from "react";

/**
 * A card-choice step that folds away once answered. A new product opens on the
 * choice; an existing one opens on what the choice configures, and the header
 * can bring the choice back (and cancel out of it, since an answer exists).
 */
export const useChoiceStep = (initiallyAnswered: boolean) => {
  const [isChoosing, setIsChoosing] = useState(!initiallyAnswered);
  const [isAnswered, setIsAnswered] = useState(initiallyAnswered);

  return {
    isChoosing,
    isAnswered,
    reopen: () => setIsChoosing(true),
    cancel: () => setIsChoosing(false),
    answer: () => {
      setIsAnswered(true);
      setIsChoosing(false);
    },
  };
};

export type ChoiceStep = ReturnType<typeof useChoiceStep>;
