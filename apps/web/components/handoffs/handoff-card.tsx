import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@louez/ui";

interface HandoffCardProps {
  title: string;
  /** One or two sentences under the title; none when the title says it all. */
  description?: React.ReactNode;
  /** A note under the description, such as a provider that did not answer. */
  note?: string | null;
  /** The form or button that moves the step on; none on a closing page. */
  children?: React.ReactNode;
}

/** The one card of a handoff page: what this step is, and what to do now. */
export const HandoffCard = ({ title, description, note, children }: HandoffCardProps) => (
  <Card>
    <CardHeader className="space-y-2 p-5 sm:p-6">
      <CardTitle className="text-xl">{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
      {note && (
        <p className="text-destructive text-sm" role="alert">
          {note}
        </p>
      )}
    </CardHeader>
    {children && (
      <CardFooter className="flex flex-col gap-2 p-5 pt-0 sm:flex-row sm:justify-end sm:p-6 sm:pt-0">
        {children}
      </CardFooter>
    )}
  </Card>
);
