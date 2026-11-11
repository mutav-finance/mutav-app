import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { cn } from "@mutav/ui/cn";

/**
 * One box per section of `/transparency`: title and description inside the
 * card, the section's figures, tables and charts in its content.
 */
export function TransparencySection({
  id,
  title,
  description,
  contentClassName,
  children,
}: {
  id: string;
  title: string;
  description: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <CardTitle id={id} className="text-base">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-4", contentClassName)}>
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
